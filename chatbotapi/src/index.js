var app = require('express')()
const bodyParser = require('body-parser')
var cors = require('cors')

// cross-origin-header.. enable all cors requests

app.use(cors())
app.use(bodyParser.json({ limit: '50mb' }))

// route to the specific version of api routes
app.use('/v1', require('./routes/v1/chatbot'))

app.listen(process.env.PORT, () => {
  console.log('listening in port: ' + process.env.PORT)
})