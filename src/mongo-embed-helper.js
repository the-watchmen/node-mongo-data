import assert from 'assert'
import debug from 'debug'
import _ from 'lodash'
import {findOne} from '@watchmen/mongo-helpr'
import {stringify, getType, getWithTypes, findDeepIndices, join} from '@watchmen/helpr'
import {
  isIdField,
  isCreate,
  isUpsert,
  isUpdate,
  isDelete,
  isUpdateOrUpsert,
  getSyntheticResult
} from './helper'
import constants from './constants'

const dbg = debug('lib:mongo-data:mongo-embed-helper')

const {MODES} = constants

export default function({contextPath, isAssociative}) {
  assert(
    _.isArray(contextPath) && !_.isEmpty(contextPath),
    'contextPath is a required non-empty array'
  )
  if (isAssociative) {
    assert(contextPath.length === 2, 'exactly two contextPath entries required when isAssociative')
  }

  async function upsert({id, data, db, opts, context, mode}) {
    dbg(
      'id=%o, type=%o, data=%j, opts=%j, context=%o, mode=%o',
      id,
      getType(id),
      data,
      opts,
      context,
      mode
    )

    if (isCreate(mode)) {
      assert(data[constants.ID_FIELD], `${constants.ID_FIELD} is required for embedded create`)
    } else {
      assert(id, 'id field required')
    }

    // derive query to uniquely identify parent record based on id and/or context values
    //
    const query = _.transform(
      contextPath,
      (result, elt) => {
        const val = elt.useId ? id : context[elt.key]
        val && (result[elt.path] = val)
        dbg('elt=%o, result=%o', elt, result)
        return !(elt.isGuid && val)
      },
      {}
    )
    dbg('query=%o', getWithTypes(query))

    const {collectionName} = opts
    const record = await findOne({db, query, collectionName})
    if (!record) {
      if (isCreate(mode)) {
        throw new Error(`unexpected record not found on embedded create, query=${stringify(query)}`)
      }
      dbg('record not found, returning null: mode=%o, query=%o', mode, query)
      return null
    }

    dbg('record=%j', record)

    const getPath = []
    let upsertIndex
    let shouldUpsert
    let notFound
    const _contextPath = getContextPath(mode)

    dbg('_context-path=%o', _contextPath)

    const pushPath = _.transform(
      _contextPath,
      (result, elt) => {
        const {arrayField, idField} = parseContextPathElt(elt)
        dbg('context-path-elt=%o, array-field=%o, id-field=%o', elt, arrayField, idField)
        if (!arrayField) {
          dbg('no array-field, skipping...')
          return
        }
        const idTarget = elt.useId || elt.idPath ? id : context[elt.key]
        result.push(arrayField)
        getPath.push(arrayField)
        dbg('get-path=%o', getPath)
        const getPathString = getPath.join('.')
        const array = _.get(record, getPathString)
        if (Array.isArray(array)) {
          let index = -1
          const predicate = _elt => _elt[idField] === idTarget
          if (elt.idPath) {
            dbg(
              'array=%j, id-path=%o, id-field=%o, id-target=%o',
              array,
              elt.idPath,
              idField,
              idTarget
            )
            const indices = findDeepIndices({array, path: elt.idPath, predicate})
            dbg('indices=%o', indices)
            index = indices ? indices.slice(0, 1) : -1
          } else {
            const _index = _.findIndex(array, predicate)
            if (_index >= 0) {
              index = _index
            }
          }
          dbg('index=%o', index)

          // eslint-disable-next-line no-negated-condition
          if (index < 0) {
            if (isUpsert(mode)) {
              shouldUpsert = true
              upsertIndex = array.length
            } else {
              dbg(
                'unable to locate element where %o=%o in %o=%j, setting not-found',
                idField,
                idTarget,
                arrayField,
                array
              )
              notFound = true
              return false
            }
          } else {
            getPath.push(`${getPath.pop()}[${index}]`)
            result.push(index)
          }
        } else if (isUpsert(mode)) {
          shouldUpsert = true
          upsertIndex = 0
        } else {
          throw new Error(`array required for ${getPathString}`)
        }
      },
      []
    )

    if (notFound) {
      dbg('not-found set, returning null')
      return null
    }

    let _idField
    if (!isUpdateOrUpsert(mode)) {
      const {arrayField, idField} = parseContextPathElt(contextPath.slice(-1)[0])
      _idField = idField
      dbg('array-field=%o, id-field=%o', arrayField, idField)
      pushPath.push(arrayField)
    }

    const pushPathString = pushPath.join('.')
    dbg('push-path=%o, data=%j', pushPathString, data)
    const collection = db.collection(collectionName)
    let update
    let _data
    if (isCreate(mode) || shouldUpsert) {
      if (shouldUpsert) {
        if (data[constants.ID_FIELD]) {
          throw new Error(`unexpected ${constants.ID_FIELD} field in data for upsert`)
        } else {
          data[constants.ID_FIELD] = id
        }
      }
      _data = {[pushPathString]: data}
      update = {$push: _data}
    } else if (isUpdateOrUpsert(mode)) {
      _data = updateElts({pushPathString, data})
      update = {$set: _data}
    } else {
      // assuming is-delete
      _data = {[pushPathString]: {[_idField]: id}}
      update = {$pull: _data}
    }

    dbg('collection=%o, id=%o, query=%o, update=%j', collectionName, id, query, update)
    let result = await collection.findOneAndUpdate(query, update)
    // dbg('result=%j', result)

    assert(result.ok, 'ok result required')
    result = getSyntheticResult({result, data, path: pushPathString})

    if (isCreate(mode)) {
      // these will all just reflect the modification of a single record,
      // but here we tweak the results to look like create/upsert as appropriate
      //
      result = {
        ...result,
        insertedId: data[constants.ID_FIELD],
        insertedCount: 1
      }
    } else if (shouldUpsert && isUpsert(mode)) {
      result = {
        ...result,
        upsertedId: data[constants.ID_FIELD],
        upsertedCount: 1,
        modifiedCount: 0
      }
    }

    // consider making filter and path keys obscured to avoid collisions with default mongo result?
    result.filter = query
    result.path = shouldUpsert ? join([pushPathString, upsertIndex]) : pushPathString
    result.update = update
    return result
  }

  async function createHook(opts) {
    return upsert({...opts, mode: MODES.create})
  }

  async function updateHook(opts) {
    return upsert({...opts, mode: opts.opts.isUpsert ? MODES.upsert : MODES.update})
  }

  async function deleteHook(opts) {
    return upsert({...opts, mode: MODES.delete})
  }

  function updateElts({pushPathString, data}) {
    return _.transform(data, (result, value, key) => {
      assert(!isIdField(key))
      result[`${pushPathString}.${key}`] = value
    })
  }

  function parseContextPathElt(elt) {
    const toks = elt.path.split('.')
    const arrayField = toks.slice(-2, -1)[0]
    const idField = toks.slice(-1)[0]
    return {arrayField, idField}
  }

  function getContextPath(mode) {
    // slice ending at -1 to skip last entry if doing create/delete because mongo commands don't include that level in "path"
    // create pushes to target array (not operating on specific entry in that array like update)
    // delete pulls from target array and accepts condition to identify element to pull
    //
    // examples:
    //
    // create: {$push: {'networks.0.plans': {_id: 'plan-1'}}}
    // update: {$set: {'networks.0.plans.0': {name: 'new name'}}}
    // delete: {$pull: {'networks.0.plans': {_id: 'plan-1'}}}}
    //
    const _isUpdate = isUpdateOrUpsert(mode)
    if (isAssociative) {
      if (isUpsert(mode)) {
        return contextPath
      }

      const idPath = contextPath[1].path.split('.').slice(1, -1)
      const first = {...contextPath[0], idPath}

      if (isUpdate(mode)) {
        return [first, contextPath[1]]
      }

      if (isDelete(mode)) {
        return [first]
      }

      // create
      //
      return [contextPath[0]]
    }

    return contextPath.slice(1, _isUpdate ? contextPath.length : -1)
  }

  return {
    createHook,
    updateHook,
    deleteHook
  }
}
