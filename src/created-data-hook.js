import debug from '@watchmen/debug'
import {isCreate, getChanged} from './helper'

const dbg = debug(__filename)

export default async function({data, context, mode}) {
	dbg('data=%j, context=%j, mode=%j', data, context, mode)

	if (isCreate(mode)) {
		const created = getChanged({context})
		return {
			...data,
			created,
			updated: created
		}
	}

	return data
}
