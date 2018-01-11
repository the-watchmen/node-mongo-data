import assert from 'assert'
import _ from 'lodash'
import debug from '@watchmen/debug'
import config from 'config'
import {getDb, parseParam, findOne} from '@watchmen/mongo-helpr'
import {pretty, getType, getWithTypes, stringify, toDotNotation} from '@watchmen/helpr'
import {registerEvent, getName, runHook, getSyntheticResult} from './helper'
import constants from './constants'

const mileToMeterMultiplier = 0.00062137
const nearMilesDefault = 10
const maxLimit = _.get(config, 'framework.data.maxLimit', 200)
const defaultLimit = _.get(config, 'framework.data.defaultLimit', 10)
const {MODES} = constants

export default function(opts) {
  const dbg = debug(__filename, {tag: getName(opts)})

  function getGet({collectionName, docField, useStepsForGet}) {
    return async function(id) {
      dbg('get: id=%o, type=%o', stringify(id), getType(id))
      const query = _.isPlainObject(id) ? id : {[constants.ID_FIELD]: id}
      if (useStepsForGet) {
        assert(!docField, 'docField is not compatible with useStepsForGet')
        const _steps = await getSteps({opts: _.omit(opts, 'queryHook'), query})
        dbg('get: steps=%s', pretty(_steps))
        return findOne({collectionName, steps: _steps})
      }
      return findOne({collectionName, query})
    }
  }

  function getIndex({collectionName, docField}) {
    const opts = arguments[0]
    return async function({query, context}) {
      const {sort, offset = 0, limit = defaultLimit} = query
      const _limit = Math.min(limit, maxLimit)
      const db = await getDb()
      const collection = db.collection(collectionName)

      const _steps = await getSteps({opts, query, sort, context})

      !_.isEmpty(sort) && _steps.push({$sort: getSort({sort, prefix: docField})})
      _steps.push({$skip: offset}, {$limit: _limit})

      dbg('index: steps=%s', pretty(_steps))

      const result = await collection.aggregate(_steps, {allowDiskUse: true}).toArray()
      dbg('index: result.length=%o', result.length)
      dbg('index: result[0]=%s', pretty(result[0]))

      return docField
        ? result.map(elt => {
            return elt[docField]
          })
        : result
    }
  }

  function getMeta({collectionName}) {
    const opts = arguments[0]
    return async function({query, context}) {
      const db = await getDb()
      const collection = db.collection(collectionName)

      const _steps = await getSteps({opts, query, context})

      // mongo aggregation count magic
      //
      _steps.push({$group: {_id: null, count: {$sum: 1}}})

      dbg('meta: steps=%s', pretty(_steps))

      const result = await collection.aggregate(_steps, {allowDiskUse: true}).toArray()

      dbg('get-meta: result=%o', result)
      return result.length ? result[0] : {count: 0}
    }
  }

  function getCreate({collectionName, isValid, createHook, idHook}) {
    const opts = arguments[0]
    const mode = MODES.create
    const emit = registerEvent({mode, opts})
    return async function({data = {}, context = {}}) {
      dbg('create: data=%o, context=%o', stringify(data), getWithTypes(context))
      assert(data, 'data required')
      const db = await getDb()
      isValid && assert(await isValid({...opts, db, data, context, mode}))
      const collection = db.collection(collectionName)
      const _data = await runHook({
        hook: opts.dataHook,
        flowKey: 'data',
        data,
        db,
        context,
        mode,
        opts
      })
      if (idHook) {
        _data[constants.ID_FIELD] = await idHook({data: _data, db, opts, context})
      }
      // dbg('create: validated data=%o', stringify(_data))
      const result = createHook
        ? await createHook({data: _data, db, opts, context})
        : await collection.insertOne(_data)
      assert.equal(result.insertedCount, 1)
      assert(result.insertedId)
      emit && (await emit({data: _data, db, opts, context}))
      return result
    }
  }

  function getUpdate({collectionName, isValid, idHook, updateHook, isUpsert, postUpdateHook}) {
    const opts = arguments[0]
    const mode = isUpsert ? MODES.upsert : MODES.update
    // currently no upsert mode for events
    const emitCreate = registerEvent({mode: MODES.create, opts})
    const emitUpdate = registerEvent({mode: MODES.update, opts})
    return async function({id, data = {}, context = {}}) {
      dbg(
        'update: id=%o, type=%o, data=%o, context=%o, is-upsert=%o',
        id,
        getType(id),
        data,
        context,
        isUpsert
      )
      assert(data, 'data required')
      const db = await getDb()
      isValid && assert(await isValid({...opts, db, data, context, mode}))
      const collection = db.collection(collectionName)
      const _data = await runHook({
        hook: opts.dataHook,
        flowKey: 'data',
        data,
        db,
        context,
        mode,
        opts
      })
      const _id = id || (isUpsert && idHook && (await idHook({data: _data, db, opts, context})))
      let filter
      let result
      let actualId = _id
      let $set
      if (updateHook) {
        result = await updateHook({id: _id, data: _data, db, opts, context})
        // dbg('update: update-hook-result=%j', result)
      } else {
        //
        // allow for non-restful client with complex filter v string id
        //
        filter = _.isPlainObject(_id) ? _id : {[constants.ID_FIELD]: id}
        $set = {$set: toDotNotation({target: _data})}

        result = await collection.findOneAndUpdate(filter, $set, {
          upsert: isUpsert || opts.isUpsert
        })

        result = getSyntheticResult({result, data: _data})
        // dbg('update: synthetic-result=%j', result)
        if (!result.matchedCount) {
          return null
        }
        actualId = result.id
      }

      result &&
        postUpdateHook &&
        (await postUpdateHook({
          result,
          id: actualId,
          filter,
          data,
          context,
          opts,
          db,
          update: $set
        }))

      if (result && (result.matchedCount || result.upsertedCount)) {
        if (result.modifiedCount) {
          emitUpdate && (await emitUpdate({data: _data, id: actualId, db, opts, context}))
        } else if (isUpsert && result.upsertedCount) {
          emitCreate && (await emitCreate({data: _data, id: actualId, db, opts, context}))
        }

        return result
      }

      return null
    }
  }

  function getDelete({collectionName, deleteHook, postDeleteHook}) {
    const opts = arguments[0]
    const emit = registerEvent({mode: MODES.delete, opts})
    return async function({id, context = {}}) {
      dbg('delete: id=%o, context=%o', id, context)
      const db = await getDb()
      const collection = db.collection(collectionName)
      let result
      if (deleteHook) {
        result = await deleteHook({id, db, opts, context})
      } else {
        //
        // allow for non-restful client with complex filter v string id
        //
        const filter = _.isPlainObject(id) ? id : {[constants.ID_FIELD]: id}
        // result = await collection.deleteOne(filter)
        result = await collection.findOneAndDelete(filter)
        // dbg('delete: result=%j', result)
        result = getSyntheticResult({result})
        // dbg('delete: synthetic-result=%j', result)
        if (!result.matchedCount) {
          return null
        }
      }

      result && postDeleteHook && (await postDeleteHook({result, context, opts, db}))

      if (result && (result.deletedCount || result.matchedCount)) {
        emit && (await emit({id, db, opts, context}))
        return result
      }

      return null
    }
  }

  function getSort({sort, prefix}) {
    const _prefix = prefix ? `${prefix}.` : ''
    const _sort = _.reduce(
      sort ? (Array.isArray(sort) ? sort : [sort]) : [],
      (result, value) => {
        if (value.startsWith('-')) {
          result[`${_prefix}${value.substring(1)}`] = -1
        } else {
          result[`${_prefix}${value}`] = 1
        }
        return result
      },
      {}
    )
    // dbg('get-sort: sort=%o, result=%o', sort, _sort)
    return _sort
  }

  function getQueryPostProcessor(opts) {
    return async function({query, context}) {
      const _query = await runHook({hook: opts.queryHook, flowKey: 'query', query, context})
      dbg('query-post-processor: query=%o, context=%o, _query=%j', query, context, _query)
      return _.reduce(
        _query,
        (result, value, key) => {
          if (!['offset', 'limit', 'sort', 'nearLat', 'nearLon', 'nearMiles'].includes(key)) {
            if (!key.startsWith('$')) {
              // don't process mongo directives
              if (Array.isArray(value)) {
                value = {$in: value}
              } else {
                value = parseParam(value)
              }
            }
            result[key] = value
          }
          return result
        },
        {}
      )
    }
  }

  async function getSteps({opts, query, context, sort}) {
    const {
      distanceField = 'distance',
      stepsHook,
      steps = [],
      postStepsHook,
      postSteps = [],
      docField: prefix
    } = opts
    const {nearLat, nearLon, nearMiles} = query
    const result = []

    const queryPostProcessor = getQueryPostProcessor(opts)
    const _query = await queryPostProcessor({query, context})
    dbg('get-steps: query=%o, _query=%o', stringify(query), stringify(_query))

    const geoStep = nearLat &&
      nearLon && {
        $geoNear: {
          near: {type: 'Point', coordinates: [nearLon, nearLat]},
          distanceField,
          maxDistance: (nearMiles || nearMilesDefault) / mileToMeterMultiplier,
          query: _query,
          spherical: true,
          distanceMultiplier: mileToMeterMultiplier,
          limit: Number.MAX_SAFE_INTEGER
        }
      }

    if (geoStep) {
      result.push(geoStep)
    }

    const _steps = stepsHook
      ? await stepsHook({steps, query, context, queryPostProcessor, sort, prefix})
      : steps
    result.push(..._steps)

    // geoStep includes query, so it is mutually exclusive with a distinct $match step
    //
    geoStep || result.push({$match: _query})

    const _postSteps = postStepsHook
      ? await postStepsHook({postSteps, query, context, queryPostProcessor, sort, prefix})
      : postSteps
    result.push(..._postSteps)

    return result
  }

  return {
    get: getGet(opts),
    index: getIndex(opts),
    meta: getMeta(opts),
    create: getCreate(opts),
    update: getUpdate(opts),
    upsert: getUpdate({...opts, isUpsert: true}),
    delete: getDelete(opts)
  }
}
