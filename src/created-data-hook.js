import debug from 'debug'
import {isCreate, getChanged} from './helper'

const dbg = debug('lib:mongo-data:created-data-hook')

export default async function({data, context, mode}) {
  dbg('data=%j, context=%j, mode=%j', data, context, mode)

  if (isCreate(mode)) {
    const created = await getChanged({context})
    return {
      ...data,
      created,
      updated: created
    }
  }
  return data
}
