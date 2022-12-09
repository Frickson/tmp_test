var app = require('express')()
const fs = require('fs')
var cors = require('cors')

// cross-origin-header.. enable all cors requests
app.use(cors())

app.get('/stream', async function (req, res) {
  const path = '/home/node/app/src/assets/chatbot.mp4'

  fs.stat(path, (err, stat) => {
    if (err) {
      res.json({ error: err.toString() })
    }

    const fileSize = stat.size
    const range = req.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-")
      const start = parseInt(parts[0], 10)
      const end = parts[1]
        ? parseInt(parts[1], 10)
        : fileSize - 1

      const chunksize = (end - start) + 1
      const file = fs.createReadStream(path, { start, end })
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      }

      res.writeHead(206, head)
      file.pipe(res)
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      }
      res.writeHead(200, head)
      fs.createReadStream(path).pipe(res)
    }
  })

})

// server listening on port 80
app.listen(process.env.PORT, () => {
  console.log('video server server listening on port ' + process.env.PORT)
})
