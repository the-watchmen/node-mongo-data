import debug from '@watchmen/debug'
import {join, assert} from '@watchmen/helpr'

const dbg = debug(__filename)

export default function({collectionName, path, field}) {
  return async function({id, db}) {
    dbg('id=%o', id)

    const result = await db
      .collection(collectionName)
      .updateMany(
        {[join([path, field, '_id'])]: id},
        {$pull: {[join([path, path && '$', field])]: {_id: id}}}
      )

    assert(
      result.modifiedCount > 0,
      () =>
        `modifications expected: collection=${collectionName}, path=${path}, field=${field}, id=${id}`
    )
  }
}
