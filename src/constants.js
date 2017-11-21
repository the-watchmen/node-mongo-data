const user = 'user'

export default {
  MODES: {
    create: 'create',
    update: 'update',
    delete: 'delete',
    upsert: 'upsert'
  },
  ID_FIELD: '_id',
  CONTEXT_USER_NAME: `${user}.userName`,
  CONTEXT_USER_ID: `${user}.userId`
}
