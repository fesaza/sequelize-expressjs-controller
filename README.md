#sequelize expressjs controller

This code allow to process any request using express-js and map the JSON body to a Sequelize model, the name of the sequelize model must be provided in the URL

It allow to insert or update a model with associations, the associations are discovered automatically based on Sequelize model. The relations allowed to be processed are `one-to-one, one-to-many`.

## How to use

Copy the code of `index.js` file into your expressjs solution and use it

Replace `Model` and `SQLConnector` paths for yours

Example:

```js
//get all rows
router.get('api/:entity', controller.index);
//insert a register of 'entity'
router.post('api/:entity', controller.create);
//update a register of 'entity' with 'id'
router.patch('api/:entity/:id', controller.UnitOfWork);
//delete a register of 'entity' with 'id'
router.delete('api/:entity/:id', controller.destroy);
```
