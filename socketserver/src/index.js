var app = require('express')()
var server = require('http').Server(app)
var io = require('socket.io')(server)
const path = require('path')
var cors = require('cors')
const request = require('superagent')

// temp only.. remove it in production
/*process.env.MASQL_HOST = 'localhost'
process.env.MYSQL_DATABASE = 'NECAIDB'
process.env.MYSQL_USER = 'necaidbuser'
process.env.MYSQL_PASSWORD = 'NECAIDBuser20171020'
process.env.jwtSecret = 'soseCREToMg8228'*/

var { Database } = require('./database')

// chatbot io namespace
var cbIO = io.of('/cbIO')

// live chat io namespace
var lcIO = io.of('/lcIO')

// insert msg into my db server
var insertMessageToDB = (identifier, livechatId, chatbotid, message, from) => {

    return new Promise(async (resolve, reject) => {

        // connect to mariadb/mysql
        let database = new Database()

        try {
            // all necessary sql queries
            const sql_queries = [
                "INSERT INTO total_messages (identifier, total_messages, livechat_id, chatbot_id) VALUES (?, 1, ?, ?) ON DUPLICATE KEY UPDATE total_messages = total_messages + 1",
                "SELECT total_messages FROM total_messages WHERE identifier=?",
                "INSERT INTO messages (identifier_message_number, message, sender) VALUES(?, ?, ?)"
            ]

            // all possible errors
            const db_errors = [
                'livechat id or chatbot id must exist'
            ]

            // livechat id or chatbot id must exist
            if (livechatId === null && chatbotid === null) {
                throw db_errors[0]
            }

            // first, insert or update the total_messages table
            let row_insertorupdate = await database.query(sql_queries[0], [identifier, livechatId, chatbotid])

            // secondly get the total_messages
            let row_totalmessages = await database.query(sql_queries[1], [identifier])

            // insert into my messages table
            let identifier_message_number = identifier + ':' + row_totalmessages[0].total_messages
            let row_insertmessage = await database.query(sql_queries[2], [identifier_message_number, message, from])

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

// cross-origin-header.. enable all cors requests
app.use(cors())
// Load View Engine
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')

// serve the client files
app.get('/', function (req, res) {

  // need to see whether the tokens are valid or not
  // check validation in client side?
  let livechatToken = req.query.livechatToken
  let chatbotToken = req.query.botToken

  if (livechatToken || chatbotToken) {
    res.render('index', {
      chatbotId: chatbotToken,
      livechatId: livechatToken
    })
  }
  else {
    // pure render the main chatbot
    res.render('index', {
      chatbotId: 'n6Avu8RVGLffnp8ghz8PaavD5R6cYzHWRPbQxh26fpCtdqgps',
      livechatId: ''
    })
  }

})

// temp.. serve the admin frontend files
app.get('/admintemp', function (req, res) {
    res.render('admin')
})

// server listening on port 80
server.listen(process.env.PORT, () => {
    console.log('livechat socket server listening on port ' + process.env.PORT)
})

// emit clientlist to all the sockets in the room (whoever is listening)
var emitMsgToRoom = (whichio, roomname, channelname, msg) => {
    whichio.to(roomname).emit(channelname, msg)
}

// emit msg to self (if i am listening)
var emitMsg = (socket, channelname, msg) => {
    socket.emit(channelname, msg)
}

// emit msg privately
var emitMsgPrivately = (from, sendto, channelname, msg) => {
    from.to(sendto).emit(channelname, msg)
}

// update and emit the list of clients' socket id
var socketClientListUpdate = (whichio, roomname, socket) => {
    try{

        // get all the sockets in the room
        let allsocketsinfo = whichio.adapter.rooms[roomname]
		//if(roomname!="lobby"&&allsocketsinfo.sockets&&whichio.adapter.rooms["lobby"]&&whichio.adapter.rooms["lobby"].sockets) allsocketsinfo.sockets = {...allsocketsinfo.sockets, ...whichio.adapter.rooms["lobby"].sockets};
        
		if(allsocketsinfo) {

            // get all the sockets in the room first
            let allsockets_id = Object.keys(allsocketsinfo.sockets)
            let clientsInfo = []
            for (let i = 0; i < allsockets_id.length; ++i) {
                let clientSocket = whichio.connected[allsockets_id[i]]
                let sessionData = clientSocket.sessionData
                // I only need clients socket
                if (sessionData.isClientMah) {
                    clientsInfo.push({ 
                        clientSocketId: allsockets_id[i], 
						clientRoom: sessionData.room,
                        clientName: sessionData.username, 
                        clientMsg: sessionData.message,
						clientAssigned: sessionData.assigned
                    })
                }

            }

            if(socket) {
                emitMsg(socket, 'clientlist_update', { clientsInfo: clientsInfo })
            }
            else {
                // emit the online clients list
                emitMsgToRoom(whichio, roomname, 'clientlist_update', { clientsInfo: clientsInfo })
            }

        }

    }
    catch(e) {
        // print out the error and carry on
        console.log(e)
    }

}

// query to chatbot pls
var queryChatbot = (socket, projectName, text_message, sender_id) => {
    request
        .post('chatbotengine/query')
        .set('contentType', 'application/json; charset=utf-8')
        .set('dataType', 'json')
        .send({
            projectName: projectName,
            text_message: text_message,
            sender_id: sender_id
        })
        .end((err, res2) => {
            if (err) {
                console.error(err.toString())
            }
            emitMsg(socket, 'chatbot_send_client', { msg: res2.body })
        })
}

var getActiveAdmin = (whichio) => {
	let activeAdmins = {};
	let sockets = whichio.connected;
	for(var i in sockets){
		var socket = sockets[i];
		var session = socket.sessionData
		if (session)
			if(!session.isClientMah){
				activeAdmins[session.room] = (activeAdmins[session.room])?activeAdmins[session.room]:0;
			}else if(session.isClientMah&&session.room!="lobby"){
				activeAdmins[session.room] = (activeAdmins[session.room])?activeAdmins[session.room]++:1;
			}
	}
	/*let activeAdmins = .filter((socket)=>{
		return socket.sessionData.isClientMah==false;
	});*/
	
		let res = Object.keys(activeAdmins).map(function (key) { return [key,activeAdmins[key]]; }).sort(function(a,b){
			return a[1]-b[1]
		});
	let result = (res.length>0)?res[0][0]:"lobby";
	console.log(`getActiveAdmins:${JSON.stringify(activeAdmins)}`);
	return result;
}

// NOTE:
// each chatbot project is one room
// i no need to care the real identity of the client for chatbot query
cbIO.on('connection', (socket) => {

    // listening on whether got any new clients request to join the chatbot room
    socket.on('client_join_room', (clientData) => {
        if(clientData.roomId) {
            // if has the roomId
            socket.join(clientData.roomId, () => {

                // get the rooms info in this socket
                let rooms = Object.keys(socket.rooms)

                // setting up the client socket session data
                socket.sessionData = {
                    room: rooms[1], // store the room name in the socket session for this client
                    isClientMah: true, // this socket is a client
                }

                // informed that new user has joined the room
                socketClientListUpdate(cbIO, socket.sessionData.room)

                // confirmation about joining this room
                emitMsg(socket, 'client_joined', { socketId: rooms[0] })

            })
        }
    })

    // listening on whether got any new admins request to join the chatbot room
    socket.on('admin_join_room', (adminData) => {
        if (adminData.roomId) {
            // if has the roomId
            socket.join(adminData.roomId, () => {

                // get the rooms info in this socket
                let rooms = Object.keys(socket.rooms)

                // setting up the client socket session data
                socket.sessionData = {
                    room: rooms[1], // store the room name in the socket session for this client
                    isClientMah: false, // this socket is an admin
                }

                // confirmation about joining this room
                emitMsg(socket, 'admin_joined', { socketId: rooms[0] })

                // let the admin know about current list of client online
                socketClientListUpdate(cbIO, socket.sessionData.room, socket)

            })
        }
    })

    // listening on whether client got send any msg to the chatbot or not
    socket.on('client_send_chatbot', (clientData) => {
        // query to chatbot pls
    })

    // when the client disconnect
    socket.on('disconnect', () => {

        try {
            let roomname = socket.sessionData.room

            if (socket.sessionData.isClientMah) {
                // if the socket is client

                // update the list of client socket id again to the room
                socketClientListUpdate(cbIO, roomname)

                // client officially leave this room
                socket.leave(roomname)

            }
            else {
                // admin officially leave this room
                socket.leave(roomname)
            }
        } catch(e) {
            console.log(e)
        }

    })
})

// NOTE:
// each live chat projects is one room
// room name will be the UUID of the livechat project
lcIO.on('connection', (socket) => {
	
	let ad = getActiveAdmin(lcIO); //auto assign //"lobby";
	emitMsg(socket,'connect_avail', ad); //ad
	
    // listening on whether got any new clients request to join any room or not
    socket.on('client_join_room', (clientData) => {
        socket.join(clientData.roomId, () => {
            // get the rooms info in this socket
            let rooms = Object.keys(socket.rooms)
            socket.sessionData = {
                room: rooms[1], // store the room name in the socket session for this client
                isClientMah: true, // this socket is a client
                username: clientData.username,
                message: clientData.message,
                attentionLevel: clientData.attentionLevel,
				assigned: null
            }
            // informed that new user has joined the room
            socketClientListUpdate(lcIO, socket.sessionData.room)

            // confirmation about joining this room
            emitMsg(socket, 'client_joined', { socketId: rooms[0] })

        })

    })

    socket.on('client_update_info', (clientData) => {
		if(!socket.sessionData) return;
        socket.sessionData.username = clientData.username
        socket.sessionData.message = clientData.message
        // informed that new user has joined the room
        socketClientListUpdate(lcIO, socket.sessionData.room)
    })

    // listening on whether got any admin request to join any room or not
    socket.on('admin_join_room', (admindata) => {
		//console.log(socket);
        //socket.join(admindata.roomId, () => {
		socket.join(admindata.roomId, () => { //"lobby"

            // get the rooms info in this socket
            let rooms = Object.keys(socket.rooms)
            socket.sessionData = {
                room: rooms[1], // store the room name in the socket session for this admin
                isClientMah: false, // this socket is not a client
                username: admindata.username,
                userid: admindata.userid,
				lcRoom:admindata.roomId
            }

            // confirmation about joining this room
            emitMsg(socket, 'admin_joined', { socketId: rooms[0] })

            // let the admin know about current list of client online
            socketClientListUpdate(lcIO, admindata.roomId, socket)

        })

    })

    // listening on whether admin want to send msg to client or not
    socket.on('admin_send_client_msg', (adminData) => {
		console.log(adminData);
		//TODO:set client's assigned person to the admin*
		let clientSocket = lcIO.connected[adminData.clientSocketId];
		if(!clientSocket.sessionData) return;
        clientSocket.sessionData.assigned = adminData.username;//socket.sessionData.lcRoom;
		socketClientListUpdate(lcIO, adminData.lcuuid)//update list for all users //"lobby"
		
        // admin is the sender
        let sender = adminData.userid

        // constructing the identifier
        let identifier = sender + ':' + adminData.clientUsername + ',' + adminData.clientSocketId

        // insert this msg to my db first
        /*insertMessageToDB(identifier, socket.sessionData.lcRoom, null, adminData.msg, sender).then(() => {
		console.log(`${adminData.clientSocketId},
                'client_receiving_msg',
                {
                    msg: ${adminData.msg},
                    adminUsername: ${adminData.username}
                }`);
            // emit the msg back to client.. avoid pulling from the db server
            emitMsgPrivately(
                socket,
                adminData.clientSocketId,
                'client_receiving_msg',
                {
                    msg: adminData.msg,
                    adminUsername: adminData.username
                }
            )

        }).catch((error) => {
            console.log(error)
        })*/
		      emitMsgPrivately(
                socket,
                adminData.clientSocketId,
                'client_receiving_msg',
                {
                    msg: adminData.msg,
                    adminUsername: adminData.username
                }
            )


    })

    // listening on whether client want to send msg to admin or not
    socket.on('client_send_admin_msg', (data) => {

		let sockets = lcIO.connected;
		for(var i in sockets){
			var currSock = sockets[i];
			var sessionData = currSock.sessionData
			if(sessionData&&!sessionData.isClientMah){

                // emit to certain admin by matching the admin username
                if (sessionData.username === data.adminUsername) {

                    let sender = data.clientUsername + ',' + data.clientSocketId
                    let identifier = sessionData.userid + ':' + sender
					
					let receiver = i;
					emitMsgPrivately(
                            socket,
                            receiver,
                            'admin_receiving_msg',
                            {
                                msg: data.msg,
								clientUsername: data.clientUsername,
                                clientSocketId: data.clientSocketId
                            }
                        )
                    /*insertMessageToDB(identifier, sessionData.lcRoom, null, data.msg, sender).then(() => {
                        // simply send it back to admin after storing it into my db.. avoid requesting my db server
                        emitMsgPrivately(
                            socket,
                            receiver,
                            'admin_receiving_msg',
                            {
                                msg: data.msg,
								clientName: data.clientUsername,
                                clientSocketId: data.clientSocketId
                            }
                        )

                    }).catch((error) => {
                        console.log(error)
                    })*/

                }
			}
		}
		/*
        // get all the sockets in the room
        let allsocketsinfo = lcIO.adapter.rooms[socket.sessionData.room]

        // need to store the client msg into my db??

        if (allsocketsinfo) {

            let allsockets_id = Object.keys(allsocketsinfo.sockets)

            // first need to find out the admin socket id
            let adminInfos = []
            for (let i = 0; i < allsockets_id.length; ++i) {

                let adminSocket = lcIO.connected[allsockets_id[i]]
                let sessionData = adminSocket.sessionData

                // I only want to emit msg to my admin
                if (sessionData.isClientMah) {
                    continue
                }
				console.log(sessionData.username + " " + data.adminUsername)

                // emit to certain admin by matching the admin username
                if (sessionData.username === data.adminUsername) {

                    let sender = data.clientUsername + ',' + data.clientSocketId
                    let identifier = sessionData.userid + ':' + sender

                    insertMessageToDB(identifier, sessionData.room, null, data.msg, sender).then(() => {

                        // simply send it back to admin after storing it into my db.. avoid requesting my db server
                        emitMsgPrivately(
                            socket,
                            allsockets_id[i],
                            'admin_receiving_msg',
                            {
                                msg: data.msg,
                                clientSocketId: data.clientSocketId
                            }
                        )

                    }).catch((error) => {
                        console.log(error)
                    })

                }

            }

        }*/

    })
	
	socket.on('admin_disconnect_client', (data) =>{
		let clientSocket = lcIO.connected[data.clientSocketId];
		clientSocket.disconnect(true);
	});

    // when the user disconnects
    socket.on('disconnect', () => {

		if(!socket.sessionData) return;
        let roomname = socket.sessionData.room

        if (socket.sessionData.isClientMah) {
            // if the socket is client

            // update the list of client socket id again to the room
            socketClientListUpdate(lcIO, roomname)

            // client officially leave this room
            socket.leave(roomname)

        }
        else {
            // admin officially leave this room
            socket.leave(roomname)
        }
		
		delete(socket.sessionData)
    })

})
