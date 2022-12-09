const router = require('express').Router()
const { check, validationResult } = require('express-validator/check')
const { matchedData, sanitize } = require('express-validator/filter')
var jwt = require('jsonwebtoken') // sign with default (HMAC SHA256)
var nodemailer = require('nodemailer')
var { Database } = require('../../database')
const bcrypt = require('bcryptjs')
const Crypto = require('crypto');

const saltRounds = 10
const confirmationUrl = "https://localhost/auth/v1/confirm"
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.email,
        pass: process.env.email_password
    }
})

// return promise to sign a jwt for the user confirmation email
var signConfirmJWT = (user_email) => {

    return new Promise((resolve, reject) => {

        // will be expire in 6 hours
        // sign a confirmation token first
        let token = jwt.sign({ data: { 'e': user_email, 'ct': true } }, process.env.jwtSecret, { expiresIn: '3h' });

        if (token) {
            resolve(token)
        }
        else {
            reject("token not generated for some reason, server error")
        }

    })

}

// return promise to sign a jwt for the user if trusted
var signLoginJWT = (user_id) => {

    return new Promise((resolve, reject) => {

        // rmb generate a new jwt to user
        // will be expire in 24 hours
        let token = jwt.sign({ data: { 'i': user_id, 'd': new Date().getTime(), 'si': true } }, process.env.jwtSecret, { expiresIn: '3h' })
        if (token) {
            resolve(token)
        }
        else {
            reject("token not generated for some reason, server error")
        }

    })

}

// send an email to user for confirmation
var sendConfirmationEmail = (user_email) => {

    return new Promise(async (resolve, reject) => {

        try {
            // sign a confirmation token first
            let jwt = await signConfirmJWT(user_email)

            // then send the email to the user with the token parameters
            let mailOptions = {
                from: process.env.email,
                to: user_email,
                subject: 'Sending Email using Node.js',
                html: `<h1>Welcome</h1><p>Confirm this registration pls 2</p><a href=${confirmationUrl + '?ctoken=' + jwt} target="_blank">Confirm</a>`
            }

            let mail_result = await transporter.sendMail(mailOptions)
            resolve(mail_result)

        }
        catch (e) {
            reject(e)
        }

    })

}

// user registration method
var userRegistration = (user_submit) => {
    return new Promise(async (resolve, reject) => {

        // connect to mariadb/mysql
        let database = new Database()

        try {
            // all necessary sql queries
            const sql_queries = [
                'SELECT EXISTS(SELECT * FROM users WHERE email=?) AS solution',
                'INSERT INTO users (email, username, password, confirm) VALUES (?, ?, ?, ?)',
                'SELECT id FROM users WHERE email=?',
                'INSERT INTO users_plans(user_id, plan_id) VALUES (?, ?)'
            ]
            // all possible errors
            const register_errors = [
                'db error cannot find solution',
                'email alr exist in db'
            ]

            let first_result_row = ''

            {
                // first check whether this email alr exist in the db or not
                let result_row = await database.query(sql_queries[0], [user_submit.email])
                first_result_row = result_row[0]
            }

            if (!first_result_row) {
                // for some reason, db return null for my solution
                throw register_errors[0]
            }

            if (first_result_row.solution) {
                // if email alr in used, then throw error
                throw register_errors[1]
            }

            // prepare to register this user into my db

            // hash the user password first
            let hash_pw = await bcrypt.hash(user_submit.password, saltRounds)

            // successfully hashed password; store user in DB
            let store_result = await database.query(sql_queries[1], [user_submit.email, user_submit.username, hash_pw, 1])

            // has alr successfully stored this user in the db

            // find the id
            let user_id = await database.query(sql_queries[2], [user_submit.email])

            // auto register a plan for this user
            let register_plan_result = await database.query(sql_queries[3], [user_id[0].id, 4])

            // then finally send the confirmation email
            //let mail_result = await sendConfirmationEmail(user_submit.email)

            resolve()

        }
        catch (e) {
            // reject the error
            reject(e.toString())
        }

        // rmb to close the db
        let dbclose = await database.close()

    })
}


var userChange = (user_submit) => {
    return new Promise(async (resolve, reject) => {

        // connect to mariadb/mysql
        let database = new Database()

        try {
			const user_row = await database.query('SELECT * FROM users WHERE email=?', [user_submit.email])
			const user_select = user_row[0]
			let hashpw_compare = await bcrypt.compare(user_submit.oldpwd, user_select.password.toString())
			if (!hashpw_compare) {
				throw "Authentication failed."
			}
			
            // all necessary sql queries
            const sql_queries = [
                'UPDATE users set password = ? where email = ?'
            ]
            // all possible errors
            const register_errors = [
                'cannot reset password'
            ]

            let first_result_row = ''

            {
                // first check whether this email alr exist in the db or not
				let hash_pw = await bcrypt.hash(user_submit.password, saltRounds)
                let result_row = await database.query(sql_queries[0], [hash_pw,user_submit.email])
            }
			
            resolve()

        }
        catch (e) {
            // reject the error
            reject(e.toString())
        }

        // rmb to close the db
        let dbclose = await database.close()

    })
}
var userReset = (user_submit) => {
    return new Promise(async (resolve, reject) => {
        let database = new Database()
        try {
            const sql_queries = [
                'UPDATE users set password = ?, login=0, failed=0 where email = ?'
            ]
            const register_errors = [
                'cannot reset password'
            ]

            let first_result_row = ''
            {
				let hash_pw = await bcrypt.hash(user_submit.password, saltRounds)
                let result_row = await database.query(sql_queries[0], [hash_pw,user_submit.email])
            }
            resolve()
        }
        catch (e) {
            reject(e.toString())
        }
        let dbclose = await database.close()
    })
}
// user login async method.. will return a jwt if everything success
var userLoginJwt = (user_submit, cb) => {
    return new Promise(async (resolve, reject) => {

        // connect to mariadb/mysql
        let database = new Database()

        try {
            // all necessary sql queries
            const sql_queries = [
                'SELECT * FROM users WHERE email=?',
                'UPDATE users SET lastlogin=CURRENT_TIMESTAMP, login=1, failed=0, token=? WHERE email=?',
				'UPDATE users set failed=failed+1 where email=?'
            ]
            // all possible errors
            const login_errors = [
                'Email or Password is incorrect.', //email does not exist
                'User has not yet confirm their email.',
                'Email or Password is incorrect.',
				'This account is already in use. [Concurrent users not allowed].',
				'Account has exceeded maximum login attempts.'
            ]

            // firstly, get the sql query info for this user by using email 
            const user_row = await database.query(sql_queries[0], [user_submit.email])

            // select the first query
            const user_select = user_row[0]

            if (!user_select) {
                // if cannot find any user based on this email, then throw error
                throw login_errors[0]
            }

            if (!user_select.confirm) {
                // if user not yet confirm their email, throw error
                throw login_errors[1]
            }

			if (user_select.failed>4) {
                // if user not yet confirm their email, throw error
                throw login_errors[4]
            }
			
            // user has alr confirmed their email

            // get the hash password from the db query
            // compare it with bcrypt
            let hashpw_compare = await bcrypt.compare(user_submit.password, user_select.password.toString())

            if (!hashpw_compare) {
                // if password is incorrect, throw an error
				await database.query(sql_queries[2], [user_submit.email]) //update failed attempt
                throw login_errors[2]+". Failed attempt "+(user_select.failed+1)
            }

            // if password is correct

            // sign the jwt and update the user last login 
            /*let all_results = await Promise.all([
                signLoginJWT(user_select.id), // sign the login jwt
                database.query(sql_queries[1], [user_select.email]) // update the user last login info
            ])*/
			var tkn = await signLoginJWT(user_select.id)
			database.query(sql_queries[1], [tkn,user_select.email])

            // resolve the jwt
            resolve({ jwt: tkn, hasLoginBefore: user_select.login })

        }
        catch (e) {
            // reject the error
            reject(e.toString())
        }

        // rmb to close the db
        let dbclose = await database.close()
    })
}

// check user confirmation or not
var updateUserConfirmation = (user_email) => {
    return new Promise(async (resolve, reject) => {

        // then update db about confimation
        // connect to mariadb/mysql
        let database = new Database()

        try {
            // all necessary sql queries
            const sql_queries = [
                'UPDATE users SET confirm=1 WHERE email=(?)'
            ]
            // all possible errors
            const register_errors = [
            ]

            // set the confirmation
            let result_row = await database.query(sql_queries[0], [user_email])

            resolve()

        }
        catch (e) {
            // reject the error
            reject(e.toString())
        }

        // rmb to close the db
        let dbclose = await database.close()
    })
}

router.post(
    '/register',
    [
        check('email').isEmail().withMessage('must be an email'),
        check('username', 'must have a username').exists().isLength({ min: 1 })
    ],
    (req, res) => {

        // checking the results
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            // if post datas is incomplete or error, return error msg
            return res.status(422).json({ success: "false", errors: errors.mapped() });
        }
        else {

            // get the matched data
            const user = matchedData(req);

			//autogen password
			var randompwd = Crypto.randomBytes(16).toString('hex').replace(/[^\w\s]/gi, '').substr(0,7)
            userRegistration({ email: user.email, password: randompwd, username: user.username }).then(() => {

                // successfully registered
                res.setHeader('Content-type', 'application/json');
                res.send(JSON.stringify({ success: 'true', msg: 'Created new account '+user.email+' with password: '+randompwd  }))

            }).catch((error) => {

                return res.status(422).json({ success: 'false', errors: error })

            })

        }
    }
)

router.post(
    '/change',
    [
        check('email').isEmail().withMessage('must be an email'),
		check('oldpwd').exists().isLength({ min: 1 }),
        check('password').exists(),
		check('re_password').exists()
    ],
    (req, res) => {

        // checking the results
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            // if post datas is incomplete or error, return error msg
            return res.status(422).json({ success: "false", errors: errors.mapped() });
        }
        else {

            // get the matched data
            const user = matchedData(req);
			console.log(user);
			var requirement =  /^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{7,15}$/;
			if(user.password.match(requirement)===null || user.password.indexOf(user.email)>-1)
			{ 
				return res.status(422).json({ success: 'false', errors: "Passwords must be at least 7-15 chars long, contain one number and special character, cannot contain email." })
			}
			if (user.password != user.re_password){
				return res.status(422).json({ success: 'false', errors: "Passwords are different." })
			}
            userChange({ email: user.email, oldpwd:user.oldpwd, 'password': user.password }).then(() => {

                // successfully registered
                res.setHeader('Content-type', 'application/json');
                res.send(JSON.stringify({ success: 'true', msg: 'password changed' }))

            }).catch((error) => {

                return res.status(422).json({ success: 'false', errors: error })

            })

        }
    }
)

router.post(
    '/reset',
    [
        check('email').isEmail().withMessage('must be an email')
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty())
            return res.status(422).json({ success: "false", errors: errors.mapped() });
        else {
			//var arr = new Uint32Array(10);
			//var randpwd = Crypto.getRandomValues(arr)
			var randompwd = Crypto.randomBytes(16).toString('hex').replace(/[^\w\s]/gi, '').substr(0,7)
            const user = matchedData(req);
            userReset({ email: user.email, password: randompwd }).then(() => {
                res.setHeader('Content-type', 'application/json');
                res.send(JSON.stringify({ success: 'true', msg: 'Password for'+user.email+' changed to '+randompwd }))
            }).catch((error) => {
                return res.status(422).json({ success: 'false', errors: error })
            })
        }
    }
)

router.post(
    '/',
    [
        check('email').isEmail().withMessage('must be an email'),
        check('password', 'passwords cannot be empty').isLength({ min: 1 })
    ],
    (req, res) => {

        // checking the results
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            // if post datas is incomplete or error, return error msg
            return res.status(422).json({ authResult: false, errors: errors.mapped() });
        }
        else {

            // get the matched data
            const user = matchedData(req);

            // user request sign in
            userLoginJwt({ email: user.email, password: user.password }).then((result) => {

                res.setHeader('Content-type', 'application/json')
                res.send(JSON.stringify({ authResult: true, jwt: result.jwt, hasLoginBefore: result.hasLoginBefore }))

            }).catch((error) => {

                return res.status(422).json({ authResult: false, errors: error })

            })

        }

    }
)

router.get('/confirm', (req, res) => {
    // get the confirmation token
    let ctoken = req.query.ctoken;

    if (ctoken) {

        // first check for token validation
        jwt.verify(ctoken, process.env.jwtSecret, (err, decoded) => {

            if (err) {
                // json token maybe expired
                return res.json({ success: false, errors: { jwt: 'json web token validate error, registration not successful' } });
            }
            else {

                if (decoded.data.ct) {

                    updateUserConfirmation(decoded.data.e).then(() => {

                        // successfully update the user confirmation
                        res.send('Thank you for joining! ' + decoded.data.e);

                    }).catch((error) => {

                        // update confirmation not successfull
                        res.send(error);

                    })

                }
                else {
                    res.send('Invalid Token, u hacka?');
                }

            }

        });

    }
    else {
        res.send('Invalid Token, u hacka?');
    }

})

// check for jwt validation
router.post(
    '/validate',
    [
        check('token', 'must have a token').exists()
    ],
    (req, res) => {

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

            jwt.verify(token, process.env.jwtSecret, (err, decoded) => {
                if (err) {
                    return res.json({ success: false, errors: { jwt: 'json web token validate error' } })
                }
                else {
                    // Officially trusted this client!
                    res.setHeader('Content-type', 'application/json')
                    res.send(JSON.stringify({ authResult: true, userid: decoded.data.i }))
                }
            })
        }

    }
)

module.exports = router