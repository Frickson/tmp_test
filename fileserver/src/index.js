var app = require('express')()
const fileUpload = require('express-fileupload')
const bodyParser = require('body-parser')
var cors = require('cors')
var fs = require('fs')
const { check } = require('express-validator/check')
const { matchedData } = require('express-validator/filter')

// default options
app.use(fileUpload())

// cross-origin-header.. enable all cors requests
app.use(cors())
app.use(bodyParser.json({ limit: '50mb' }))

// route to the specific version of api routes
app.get('/', (req, res) => {
    res.json('hello')
})

app.post('/upload', function (req, res) {
    if (!req.files)
        return res.status(400).send('No files were uploaded.')

    // The name of the input field (i.e. "sampleFile") is used to retrieve the uploaded file
    let sampleFile = req.files.sampleFile

    // Use the mv() method to place the file somewhere on your server
    sampleFile.mv('/home/node/app/static/' + sampleFile.name, function (err) {
        if (err)
            return res.status(500).send(err)

        res.send('File uploaded!')
    });
})

app.get('/infos', (req, res)=>{

    let path = '/home/node/app/static'
    let returndata = []

    let items = fs.readdirSync(path)

    for (var i = 0; i < items.length; i++) {
		
		let file = path + '/' + items[i]
		
		let stats = fs.statSync(file)
		let size = stats["size"]
		var convertsize = Math.floor(Math.log(size) / Math.log(1024))
		let finalsize = (size / Math.pow(1024, convertsize)).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][convertsize]
		if(!req.query.uuid || (file.indexOf(req.query.uuid) !== -1) ){
			returndata.push({ name: items[i], size: finalsize })
		}
    }

    res.json(returndata)

})

app.post('/imageByProject', [check('uuid', 'UUID required.').exists().isLength({ min: 1 })], (req, res)=>{
	console.log(req)
	const uuid = matchedData(req).uuid
    let path = '/home/node/app/static/'+uuid
    let returndata = []
	if(!fs.existsSync(path)) fs.mkdirSync(path)
	fs.chmodSync(path, 0664)
    let items = fs.readdirSync(path)
    for (var i = 0; i < items.length; i++) {
        var file = path + '/' + items[i]
        returndata.push({ name: uuid+'/'+items[i] })
    }
    res.json(returndata)
})

app.post('/uploadImageByProject', (req, res)=>{
	const uuid = req.body.uuid
    if (!req.files)
        return res.status(400).send('No files were uploaded.')
	let path = '/home/node/app/static/'+uuid
	if(!fs.existsSync(path)) fs.mkdirSync(path)
	fs.chmodSync(path, 0664)
	let sampleFile = req.files.sampleFile    
	sampleFile.mv(path + '/' + sampleFile.name, function (err) {
        if(err) return res.status(500).send(err)
		res.json({result:`File ${sampleFile.name} uploaded into ${req.body.uuid}`})
    });
})

app.get('/getfileinfo', (req, res)=>{

    let path = '/home/node/app/static'
    let returndata = []

    var file = path + '/' + req.query.filename
       
    let stats = fs.statSync(file)

    size = stats["size"]
    var convertsize = Math.floor(Math.log(size) / Math.log(1024))
    let finalsize = (size / Math.pow(1024, convertsize)).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][convertsize]

    returndata.push({ name: req.query.filename, size: finalsize })

    res.json(returndata)

})

app.delete('/remove', (req, res)=>{
    var filePath = '/home/node/app/static'
    fs.unlinkSync(filePath + '/' + req.query.filename)
    res.json('removed')

})

app.listen(process.env.PORT, () => {
    console.log('listening in port: ' + process.env.PORT)
})