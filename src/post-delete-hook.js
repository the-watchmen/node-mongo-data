import assert from 'assert'
import _ from 'lodash'
import debug from 'debug'
import {getName, getContextDate, getContextUser, captureDataChange} from './helper'
import constants from './constants'

const dbg = debug('lib:mongo-data:post-delete-hook')

export default async function({result, context, opts}) {
  dbg(
    'target=%o, result=%o, context=%o',
    getName(opts),
    _.pick(result, ['matchedCount', 'upsertedCount', 'modifiedCount', 'path', 'filter']),
    context
  )

  if (result.result.n) {
    const _result = await captureDataChange({
      target: opts.collectionName,
      mode: constants.MODES.delete,
      user: await getContextUser(context),
      date: getContextDate(context),
      data: result.original,
      update: result.update
    })
    assert(_result.result.ok, 'ok result required')
  }
}
