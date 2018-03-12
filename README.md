# sequelize expressjs controller

This code allow to process any request using express-js and map the JSON body to a Sequelize model, the name of the sequelize model must be provided in the URL

## How to use

Copy the code of `index.js` file into your expressjs solution and use it

Replace `Model` and `SQLConnector` paths for yours

Example:
`router.get('api/:entity', passport.authenticate('bearer', { session: false }), controller.index);
router.post('api/:entity', passport.authenticate('bearer', { session: false }), controller.create);
router.patch('api/:entity/:id', passport.authenticate('bearer', { session: false }), controller.UnitOfWork);
router.delete('api/:entity/:id', passport.authenticate('bearer', { session: false }), controller.destroy);
`

