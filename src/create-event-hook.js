import assert from 'assert'
import _ from 'lodash'
import debug from '@watchmen/debug'
import {stringify, join} from '@watchmen/helpr'
import {stripPlaceholders, getName} from './helper'
import constants from './constants'

const dbg = debug(__filename)

// this will currently only handle paths with a _single_ mongo placeholder,
// see create-deep-nested-event-hook for homegrown multiple placeholder support
//
// when/if mongo supports multiple placeholders, in theory this should work as-is.
//
// keep an eye on these for multiple placeholder support from mongo in the future:
//
// ref: https://jira.mongodb.org/browse/SERVER-831
// ref: https://jira.mongodb.org/browse/SERVER-27089
//
export default function({target, path, fields, filterHook}) {
	dbg('target=%o, path=%o, fields=%o', target, path, fields)
	assert(target && path && filterHook, 'target, path and filterHook required')

	const defaultFilterIdPath = join([
		...stripPlaceholders(path)
			.split('.')
			.slice(0, -1),
		constants.ID_FIELD
	])

	dbg('default-filter-id-path=%o', defaultFilterIdPath)

	return async function({opts, id, data, db, context}) {
		dbg(
			'target=%o, entity=%o, id=%o, data=%o, context=%o, mode=%o',
			target,
			getName(opts),
			id,
			stringify(data),
			stringify(context)
		)

		if (!data[constants.ID_FIELD]) {
			data[constants.ID_FIELD] = id
		}

		const filter = await filterHook({opts, id, data, context, db, defaultFilterIdPath})
		const pickedData = fields ? _.pick(data, [...fields, constants.ID_FIELD]) : data

		dbg(
			'target=%o, id=%o, filter=%o, path=%o, picked-data=%o',
			target,
			id,
			filter,
			path,
			stringify(pickedData)
		)

		const result = await db.collection(target).updateMany(filter, {$push: {[path]: pickedData}})

		// dbg('result=%o', result)
		assert(result.result.ok, 'ok result required')
		dbg('modified-count=%o', result.modifiedCount)
	}
}
