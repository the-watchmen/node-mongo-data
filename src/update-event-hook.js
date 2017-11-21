import assert from 'assert'
import _ from 'lodash'
import debug from 'debug'
import {stringify, join, findDeepIndices} from '@watchmen/helpr'
import {toDotNotation} from '@watchmen/mongo-helpr'
import {getName, getIdPath, stripPlaceholders} from './helper'

const dbg = debug('lib:mongo-data:update-event-hook')

export default function({target, path, fields}) {
  // when/if mongo supports multiple placeholders
  // delete this "exit" and updateDeepNestedEventHook..
  //
  // keep an eye on these for multiple placeholder support from mongo in the future:
  //
  // ref: https://jira.mongodb.org/browse/SERVER-831
  // ref: https://jira.mongodb.org/browse/SERVER-27089
  //
  const placeHolderCount = path.split('$').length - 1
  if (placeHolderCount > 1) {
    return updateDeepNestedEventHook(arguments[0])
  }

  dbg('target=%o, path=%o, fields=%o', target, path, fields)
  assert(target && path, 'target and path required')

  return async function({id, data, db, mode, opts}) {
    dbg(
      'entity=%o, target=%o, id=%o, data=%o, mode=%o',
      getName(opts),
      target,
      id,
      stringify(data),
      mode
    )

    const idPath = getIdPath(path)

    const dotted = toDotNotation({target: data})
    const dottedPicks = fields
      ? _.pickBy(dotted, (val, key) => {
          // dbg('key=%o, val=%o', key, val)
          return _.some(fields, elt2 => {
            // dbg('key=%o, elt2=%o', key, elt2)
            return key.startsWith(elt2)
          })
        })
      : dotted

    // dbg('dotted=%o, dotted-picks=%o', dotted, dottedPicks)

    if (!_.isEmpty(dottedPicks)) {
      const $set = _.transform(dottedPicks, (result, val, key) => {
        result[`${path}.${key}`] = val
      })
      const filter = {[idPath]: id}
      // dbg('filter=%o, $set=%o', filter, $set)
      const result = await db.collection(target).updateMany(filter, {$set})
      // dbg('result=%o', result)
      assert(result.result.ok, 'ok result required')
      // dbg('modified-count=%o', result.modifiedCount)
    }
  }
}

// because we can't curently use multiple mongo update placeholders
// for deeply nested arrays, we use this strategy.
//
// keep an eye on the following for a better way:
//
// ref: https://jira.mongodb.org/browse/SERVER-831
// ref: https://jira.mongodb.org/browse/SERVER-27089
//
function updateDeepNestedEventHook({target, path, fields}) {
  dbg('target=%o, path=%o, fields=%o', target, path, fields)
  assert(path, 'path required')

  const fullPathArray = path.split('.$.')
  const fullPath = stripPlaceholders(path)
  const pathHead = fullPathArray[0]
  const filter = `${fullPath}._id`

  let pathTail = fullPathArray[fullPathArray.length - 1]
  let arrayPathArray
  let idPath

  if (pathTail.endsWith('.$')) {
    pathTail = pathTail.replace('.$', '')
    fullPathArray[fullPathArray.length - 1] = pathTail
    arrayPathArray = fullPathArray.slice(1)
  } else {
    // last element is _not_ an array
    arrayPathArray = fullPathArray.slice(1, -1) // strip non-array end
    idPath = pathTail
  }

  return async function({opts, id, data, db, context, mode}) {
    dbg(
      'entity=%o, target=%o, id=%o, data=%o, context=%o, mode=%o',
      getName(opts),
      target,
      id,
      stringify(data),
      context,
      mode
    )

    const cursor = await db.collection(target).find({[filter]: id})

    /* eslint-disable no-await-in-loop */
    do {
      // eslint-disable-next-line no-var
      var record = await cursor.next()
      if (record) {
        const array = _.get(record, pathHead)
        // dbg('record=%o, array=%o', stringify(record), pathHead)
        if (array) {
          const _idPath = join([idPath, '_id'])
          const indices = findDeepIndices({
            array,
            path: arrayPathArray,
            predicate: elt => _.get(elt, _idPath) === id
          })
          // dbg('path=%o, id-path=%o, id=%o, indices=%o', arrayPathArray, _idPath, id, indices)

          if (indices) {
            const dotted = toDotNotation({target: data})
            const dottedPicks = fields
              ? _.pickBy(dotted, (val, key) => {
                  // dbg('key=%o, val=%o', key, val)
                  return _.some(fields, elt2 => {
                    // dbg('key=%o, elt2=%o', key, elt2)
                    return key.startsWith(elt2)
                  })
                })
              : dotted

            // dbg('path=%o, fields=%o, dotted=%o, dotted-picks', path, fields, dotted, dottedPicks)

            const $set = _.transform(dottedPicks, (result, val, key) => {
              // example:
              // indices: [1, 2]
              // path: ['widgets', 'holder.whatsits', 'nested']
              // key: 'attribute1'
              // result: 'widgets.1.holder.whatsits.2.nested.attribute1'
              //
              const indexedKey = join(
                _.zipWith(fullPathArray, indices, (a, b) => join([a, b])).concat(key)
              )
              result[indexedKey] = val
            })

            // dbg('$set=%j', $set)

            const result = await db.collection(target).updateOne({_id: record._id}, {$set})
            assert(result.result.n > 0, `modifications expected for record with id=${id}`)
          }
        }
      }
      // eslint-disable-next-line block-scoped-var
    } while (record)
  }
}
