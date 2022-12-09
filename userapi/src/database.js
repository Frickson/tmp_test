var mysql = require('mysql')

exports.Database = class {

    constructor(config = {
        host: process.env.MASQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    }) {
        this.connection = mysql.createConnection(config)
    }

    query(sql, args) {
        return new Promise((resolve, reject) => {
            this.connection.query(sql, args, (err, rows) => {
                if (err) {
                    return reject(err)
                }
                resolve(rows)
            });
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            this.connection.end(err => {
                if (err) {
                    return reject(err)
                }
                resolve()
            })
        })
    }

}