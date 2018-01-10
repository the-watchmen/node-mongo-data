import _ from 'lodash'
import debug from '@watchmen/debug'
import {join, stringify, assert} from '@watchmen/helpr'
import {getChanged, getName, captureDataChange} from './helper'

const dbg = debug(__filename)

export default async function({result, filter, context, opts, db, update}) {
  dbg(
    'target=%j, filter=%j, result=%j, context=%j',
    getName(opts),
    filter,
    _.pick(result, ['matchedCount', 'upsertedCount', 'modifiedCount', 'path', 'filter']),
    context
  )

  const _filter = filter || result.filter
  assert(_filter, 'filter required')
  const $set = {}

  if (result.upsertedCount || result.modifiedCount) {
    const {path} = result
    const changed = getChanged({context})

    if (result.upsertedCount) {
      $set[join([path, 'created'])] = changed
    }

    $set[join([path, 'updated'])] = changed

    dbg('filter=%j, $set=%j', _filter, $set)

    let _result = await db.collection(opts.collectionName).updateOne(_filter, {$set})

    assert(
      _result.result.n,
      () => `match in collection=${opts.collectionName} with filter=${stringify(filter)} expected`
    )

    if (result.modifiedCount) {
      _result = await captureDataChange({
        target: opts.collectionName,
        data: result.original,
        update: update || result.update,
        ...changed
      })
      assert(_result.result.ok, 'ok result required')
    }
  }
}
