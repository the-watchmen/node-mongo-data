import assert from 'assert'
import _ from 'lodash'
import debug from '@watchmen/debug'
import {getName, getChanged, captureDataChange} from './helper'
import constants from './constants'

const dbg = debug(__filename)

export default async function({result, context, opts}) {
	dbg(
		'target=%o, result=%o, context=%o',
		getName(opts),
		_.pick(result, ['matchedCount', 'upsertedCount', 'modifiedCount', 'path', 'filter']),
		context
	)

	if (result.result.n) {
		const changed = getChanged({context})
		const _result = await captureDataChange({
			target: opts.collectionName,
			mode: constants.MODES.delete,
			data: result.original,
			update: result.update,
			...changed
		})
		assert(_result.result.ok, 'ok result required')
	}
}
