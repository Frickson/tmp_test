const router = require('express').Router()
var jwt = require('jsonwebtoken') // sign with default (HMAC SHA256)
const { check, validationResult } = require('express-validator/check')
const { matchedData, sanitize } = require('express-validator/filter')

var { Database } = require('../../database')

// get the live chat info based on this uuid
var getUserInfo = (user_id) => {
	console.log("in getUserInfo")
    return new Promise(async (resolve, reject) => {

        // connect to mariadb/mysql
        let database = new Database()

        try {
            // all necessary sql queries
            const sql_queries = [
                'SELECT * FROM users WHERE id=?'
            ]

            // all possible errors
            const db_errors = [
                'no such registered user in db'
            ]

            // delete this intent
            let row_user = await database.query(sql_queries[0], [user_id])

            if (!row_user[0]) {
                throw db_errors[0]
            }

            // return the user info
            let userinfo = {
                id: row_user[0].id,
                email: row_user[0].email,
                username: row_user[0].username,
                joindate: row_user[0].joindate,
				admin: row_user[0].admin
            }
			console.log("in getUserInfo: returning userinfo")
			await database.close()
            resolve(userinfo)

        }
        catch (e) {
            // reject the error
			console.log("in getUserInfo: caught error")
			await database.close()
            reject(e.toString())
        }

        // rmb to close the db
        let dbclose = await database.close()

    })

}

var checkToken = async (token) => {
	let database = new Database();
	let dbq = await database.query("select * from users where token=?", [token]);
	await database.close()
	return dbq;
}
	
// get the live chat info based on this uuid
var userLogout = (user_id) => {

    return new Promise(async (resolve, reject) => {

        // connect to mariadb/mysql
        let database = new Database()

        try {
            // all necessary sql queries
            const sql_queries = [
                'UPDATE users SET login=0 WHERE id=?'
            ]

            // all possible errors
            const db_errors = [
                'no such registered user in db'
            ]

            // update this login
            let row_updatelogin = await database.query(sql_queries[0], [user_id])
			await database.close()
            resolve()

        }
        catch (e) {
            // reject the error
			await database.close()
            reject(e.toString())
        }

        // rmb to close the db
        let dbclose = await database.close()

    })

}

// every api router will go through JWT verification first
router.use(
    [
        check('token', 'must have a token').exists()
    ],
    async (req, res, next) => {
		console.log("in router use:")
        // checking the results
        const errors = validationResult(req)

        if (!errors.isEmpty()) {
            // if request datas is incomplete or error, return error msg
            return res.status(422).json({ success: false, errors: errors.mapped() })
        }
        else {
            // get the matched data
            // get the jwt token from body
            let token = matchedData(req).token
			console.log("in router use: checking token")
			let dbq = await checkToken(token)
			if(!dbq[0]){
				//token has expired
				console.log("in router use: token expired")
				return res.json({ success: false, errors: { jwt: 'json web token overwritten' } })
			}
			
            jwt.verify(token, process.env.jwtSecret, (err, decoded) => {
                if (err) {
					console.log("in router use: error while verifying token")
                    return res.json({ success: false, errors: { jwt: 'json web token validate error' } })
                }
                else {

                    // Officially trusted this client!
					console.log("in router use: docoded token")
                    req.decoded = decoded
                    next()
                }
            })
			//end
        }

    }
)
var signLoginJWT = (user_id) => {
    //return new Promise((resolve, reject) => {
        // rmb generate a new jwt to user
        // will be expire in 24 hours
		console.log("in signLoginJWT: generating new token")
        let token = jwt.sign({ data: { 'i': user_id, 'd': new Date().getTime(), 'si': true } }, process.env.jwtSecret, { expiresIn: '3h' })
        if (token) {
			console.log("in signLoginJWT: token resolved")
            return token
			//resolve(token)
        }
        else {
			console.log("in signLoginJWT: token not generated")
            //reject("token not generated for some reason, server error")
        }
    //})
}
var refreshToken = (userid, userinfo, oldToken) => {
	return new Promise(async (resolve, reject) => {
		let database = new Database()
		try{
			console.log(`in refreshToken: updating old token ${oldToken}`)
			q = 'UPDATE users SET lastlogin=CURRENT_TIMESTAMP, login=1, failed=0, token=? WHERE id=?';
			var newToken = signLoginJWT(userid)
			const dbRes = await database.query(q, [newToken,userid])
			userinfo.token = newToken
			//res.setHeader('Content-type', 'application/json')
			console.log(`in refreshToken: new token generated ${userinfo.token}`)
			resolve({ success: true, userinfo: userinfo })
		}
		catch(e){
			console.log("in refreshToken: reject refresh")
            reject("JSON web token unauthenticated.")
		}
		finally{
			const dbClose = await database.close()
		}
    })
}
router.post('/', (req, res) => {
	console.log("in post:")
    getUserInfo(req.decoded.data.i).then((userinfo) => {
		try{
			jwt.verify(req.body.token, process.env.jwtSecret, (err, decoded) => {
				if (err) { console.log("in post: err1");throw "Error" }
				else {
					refreshToken(decoded.data.i, userinfo, req.body.token).then(
						(success)=>{
							console.log("in post: success")
							return res.send(success)
						},
						(e)=>{
							console.log("in post: cannot auth")
							throw "Cannot authenticate";
						}
					)
				}
			})
        }
		catch(error) {
			console.log("in post: err2")
			return res.status(422).json({ success: false, errors: error })
		}
	})
})

router.get('/logout', (req, res) => {

    userLogout(req.decoded.data.i).then(() => {
        // send the result back to client
        res.setHeader('Content-type', 'application/json')
        res.send(JSON.stringify({ logout: true }))
    }).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
    })

})

module.exports = router