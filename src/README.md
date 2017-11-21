# Data Framework

This framework capitalizing on the feature rich set provided by [the Mongo Node Adapter](https://mongodb.github.io/node-mongodb-native/) to provide the CRUD operations required to power a Web-API.

## Configurable CRUD Functions

This framework exposes configurable functions supporting required Web-API operations:

- `getIndex`
- `getMeta`
- `getGet`
- `getCreate`
- `getUpdate`
- `getDelete`

The above functions are defined in [this data component](./data.js) and are effectively used to power upstream components in a consistent and efficient manner.

### Parameters

#### Common
- `collectionName`: name of Mongo collection to use for resource
- `name`: (optional) name to use if different from collection name (typically used for embedded resources)

#### getGet
- `steps`: (optional) Mongo aggregation pipeline steps used _before_ the query to manipulate data
- `idField`: (default=`_id`) field in document to match against passed id
- `useStepsForGet`: (optional) set to true to use `steps` prior to attempting id match

#### getIndex
- `steps`: (optional) Mongo aggregation pipeline steps used _before_ the query to manipulate data
- `postSteps`: (optional) Mongo aggregation pipeline steps used _after_ the query to manipulate data
- `docField`: (optional) identifies a field containing a Mongo [$$ROOT](https://docs.mongodb.com/manual/reference/aggregation-variables/) construct to expand into result doc
- `queryHook`: (optional) arbitrary function used to pre-process the query
- `distanceField`: (default=`distance`) can be used to nest [$geoNear](https://docs.mongodb.com/v3.2/reference/operator/aggregation/geoNear/) distance field (e.g. `location.distance`)

#### getMeta
- `steps`: (optional) Mongo aggregation pipeline steps used _before_ the query to manipulate data
- `queryHook`: (optional) arbitrary function used to pre-process the query

#### getCreate
- `isValid`: (optional) validation function of form `(data)=>{return boolean}`
- `dataHook`: (optional) function which can augment data of form `({data, db, opts})=>{return data}`
- `createHook`: (optional) function to perform create of form `({data, db, opts, context})=>{return result}`
- `createEventHooks`: (optional) array of functions to call post create of form `({data, db, opts, context})=>{return result}`

#### getUpdate
- `isValid`: (optional) validation function of form `(data)=>{return boolean}`
- `idField`: (default=`_id`) field in document to match against passed id
- `dataHook`: (optional) function which can augment data of form `({id, data, db, opts})=>{return data}`
- `updateHook`: (optional) function to perform update of form `({id, data, db, opts, context})=>{return result}`
- `updateEventHooks`: (optional) array of function to call post update of form `({id, data, db, opts, context})=>{return result}`

####  getDelete
- `idField`: (default=`_id`) field in document to match against passed id
- `deleteEventHooks`: (optional) array of functions to call post delete of form `({id, db, opts, context})=>{return result}`

### Example

> Currently the configurable router is the only component directly consuming this component, so you will see configuration of this component at the router level.

## Embedded Resources

In some cases we want to expose a Web-API for a resource that is embedded in another document.

For this case, we have custom `createHook` and `updateHook` functions that can plug into the framework.

These functions are defined [here](./mongo-embed-helper.js).

### Parameters

- `embedded.contextPath`: array with elements of the form `{key, path, isGuid}`

> see [this related test](../test/ava/mongo-embed-helper-test.js) for more context (see what i did there?)
