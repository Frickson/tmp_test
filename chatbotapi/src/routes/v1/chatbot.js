const router = require("express").Router();
var jwt = require("jsonwebtoken"); // sign with default (HMAC SHA256)
const { check, validationResult } = require("express-validator/check");
const { matchedData, sanitize } = require("express-validator/filter");
const uuidv4 = require("uuid/v4");
const bs58 = require("bs58");
const request = require("superagent");
var fs = require("fs");
var webHookHelper = require("./webHookHelper");
var ipRangeCheck = require("ip-range-check");

let trainQueue = [];
let trainData = {};
let nowTraining = null;
var addTrainingToQueue = (
  cbuuid,
  domain,
  storiesmdstr,
  newintents,
  nludata,
  cycles
) => {
  console.log(`addTrainingToQueue:${cbuuid}`);
  if (!trainQueue.includes(cbuuid)) {
    console.log(
      `this project does not exist in training queue, adding to queue.`
    );
    trainQueue.push(cbuuid);
  }
  console.log(`current queue: ${trainQueue}`);
  //already exist in training queue, update the train data
  trainData[cbuuid] = {
    projectName: cbuuid,
    domain: domain,
    stories: storiesmdstr,
    newintents: newintents,
    nlujson: nludata,
    cycle: cycles,
  };
  startTraining();
};
var startTraining = async () => {
  console.log(`startTraining:`);
  console.log(`Currently training: ${nowTraining}`);
  if (nowTraining == null) {
    if (trainQueue.length > 0) {
      nowTraining = "locked";
      cbToTrain = trainQueue.shift();
      console.log(`Starting training of next chatbot in queue: ${cbToTrain}`);
      nowTraining = { uuid: cbToTrain, startTime: new Date() };
      console.log(trainData[cbToTrain]);
      await trainCB(trainData[cbToTrain]);
    } else {
      console.log(`Nothing left in queue to train.`);
    }
  } else {
    console.log(
      `startTraining invoked but a chatbot is being trained at the moment. Please wait.`
    );
  }
};

var trainCB = async (cbdata) => {
  try {
    console.log(
      `trainCB: Training chatbot ${cbdata.projectName} with data: ${cbdata}`
    );
    console.log(`trainCB: Training nlu`);
    let nlutrainning = await request
      .post(
        "nluengine:5000/train?project=" +
          cbdata.projectName +
          "&fixed_model_name=model&model=model&pipeline=config_spacy"
      ) //model=model
      .set("contentType", "application/json; charset=utf-8")
      .set("dataType", "json")
      .send({
        rasa_nlu_data: cbdata.nlujson,
        //,config: {'fixed_model_name':'model'}
      });
    console.log(`trainCB: Training dialogue`);
    // train the dialogues later
    let dialoguetrainning = await request
      .post("trainengine/training")
      .set("contentType", "application/json; charset=utf-8")
      .set("dataType", "json")
      .set("dataType", "json")
      .send(cbdata);
    console.log(`trainCB: Training completed.`);
  } catch (error) {
    console.log(`trainCB FAILED: ${error}`);
  } finally {
    nowTraining = null;
    delete trainData[cbdata.projectName];
    startTraining();
    return true;
  }
};

var { Database } = require("../../database");

// generate a uuid for chatbot
var getUUID = () => {
  return bs58.encode(Buffer.from(uuidv4()));
};

// create new live chat for this user
var createNewChatbot = (user_submit) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in createNewChatbot`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      const sql_queries = [
        "SELECT plan_id FROM users_plans WHERE user_id=?",
        "SELECT * FROM plans WHERE id=?",
        "SELECT * FROM chatbot WHERE createdby=?",
        "INSERT INTO chatbot (uuid, createdby, name, description) VALUES (?, ?, ?, ?)",
        "INSERT INTO chatbot_ml_datas (uuid) VALUES (?)",
      ];

      // all possible errors
      const db_errors = [
        "cannot find user plan id",
        "cannot find the plan detail",
        "chatbot project exceed limit",
      ];

      // do things in parallel
      let all_results = await Promise.all([
        new Promise(async (resolve, reject) => {
          // find out the user current plans

          let user_planid = "";

          {
            // find the plan id
            let row_plan_id = await database.query(sql_queries[0], [
              user_submit.user_id,
            ]);
            user_planid = row_plan_id[0];
          }

          if (!user_planid) {
            reject(db_errors[0]);
          }

          let plan_info = "";

          {
            let row_plan_info = await database.query(sql_queries[1], [
              user_planid.plan_id,
            ]);
            plan_info = row_plan_info[0];
          }

          if (!plan_info) {
            reject(db_errors[1]);
          }

          // return the user signed up plan info
          resolve(plan_info);
        }),
        new Promise(async (resolve, reject) => {
          // find all projects created by this user
          let row_livechats = await database.query(sql_queries[2], [
            user_submit.user_id,
          ]);
          resolve(row_livechats);
        }),
      ]);

      let plan_info = all_results[0];
      let all_chatbots = all_results[1];

      if (all_chatbots.length >= plan_info.chatbot_limit) {
        throw db_errors[2];
      }

      // create the new chatbot
      let row_insert_chatbot = await database.query(sql_queries[3], [
        user_submit.uuid,
        user_submit.user_id,
        user_submit.name,
        user_submit.description,
      ]);
      let row_insert_payload = await database.query(sql_queries[4], [
        user_submit.uuid,
      ]);
      resolve(row_insert_chatbot.insertId);
      resolve(row_insert_payload.insertId);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

var deleteChatbotProject = (chatbot_uuid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in deleteChatbotProject`);
    let database = new Database();
    try {
      const sql_queries = [
        "DELETE FROM chatbot WHERE uuid=?",
        "DELETE FROM chatbot_ml_datas WHERE uuid=?",
        "DELETE FROM chatbot_access WHERE uuid=?",
      ];
      const db_errors = ["delete chatbot err:"];
      let all_results = await Promise.all([
        new Promise(async (resolve, reject) => {
          let row_deletechatbot = await database.query(sql_queries[0], [
            chatbot_uuid,
          ]);
          /*if (!row_deletechatbot.affectedRows) {
            reject(db_errors[0]+"chatbot")
          }*/
          resolve(row_deletechatbot);
        }),
        new Promise(async (resolve, reject) => {
          let row_deletepayload = await database.query(sql_queries[1], [
            chatbot_uuid,
          ]);
          /*if (!row_deletepayload.affectedRows) {
            reject(db_errors[0]+"chatbot data")
          }*/
          resolve(row_deletepayload);
        }),
        new Promise(async (resolve, reject) => {
          let row_deletepayload = await database.query(sql_queries[2], [
            chatbot_uuid,
          ]);
          /*if (!row_deletepayload.affectedRows) {
            reject(db_errors[0]+"chatbot access")
          }*/
          resolve(row_deletepayload);
        }),
        request
          .post("coreengine/deleteProject")
          .set("contentType", "application/json; charset=utf-8")
          .set("dataType", "json")
          .send({
            projectName: chatbot_uuid,
          }),
      ]);
      resolve();
    } catch (e) {
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

// refresh live chat project uuid

var updateIntentHit = (
  chatbot_uuid,
  intentname,
  sender_id,
  text_message,
  session_id,
  msgID,
  actionname
) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in updateIntentHit`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      const sqlSimilarResolved =
        "SELECT * from intents_hits where uuid=? AND txtmsg=? AND intentname=? AND response_json=? AND flag=1 GROUP BY txtmsg"; //feedback, flag
      const numSimilarResolved = await database.query(sqlSimilarResolved, [
        chatbot_uuid,
        text_message,
        intentname,
        actionname,
      ]);
      let newIntentFlag = numSimilarResolved.length >= 1 ? 1 : 0;
      // all necessary sql queries
      const sql_queries = [
        "INSERT INTO intents_hits (uuid, intentName, senderID, txtmsg, sessionID, response_json, msgID, flag) VALUES (?, ?, ?, ?, ?, ?, ?,?)",
      ];

      // all possible errors
      const db_errors = ["no such chatbot project"];

      const inserthit = await database.query(sql_queries[0], [
        chatbot_uuid,
        intentname,
        sender_id,
        text_message,
        session_id,
        actionname,
        msgID,
        newIntentFlag,
      ]);

      // if update finish
      resolve(inserthit);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

// Update Message Response
var updateMessageResponse = (
  botMsgResponse,
  chatbot_uuid,
  session_id,
  msgID
) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in updateMessageResponse`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      const sql_queries = [
        "Update intents_hits set response_json =? Where uuid=? and sessionID=? and msgID=?",
      ];
      // all possible errors
      const db_errors = ["no such chatbot project"];

      const inserthit = await database.query(sql_queries[0], [
        botMsgResponse,
        chatbot_uuid,
        session_id,
        msgID,
      ]);

      // if update finish
      resolve();
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

// Update Feedback
var updateFeedback = (feedback, chatbot_uuid, session_id, msgID) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in updateFeedback`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      const sql_queries = [
        "Update intents_hits set feedback =? Where uuid=? and sessionID=? and msgID=?",
      ];
      // all possible errors
      const db_errors = ["no such chatbot project"];

      const inserthit = await database.query(sql_queries[0], [
        feedback,
        chatbot_uuid,
        session_id,
        msgID,
      ]);

      // if update finish
      resolve();
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

// refresh live chat project uuid
var refreshChatbotUUID = (chatbot_uuid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in refreshChatbotUUID`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      const sql_queries = ["UPDATE chatbot SET uuid=? WHERE uuid=?"];

      // all possible errors
      const db_errors = ["no such chatbot project"];

      // delete this intent
      let row_updateuuid = await database.query(sql_queries[0], [
        getUUID(),
        chatbot_uuid,
      ]);

      if (!row_updateuuid.affectedRows) {
        throw db_errors[0];
      }

      resolve();
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

// get the intents_hits based on this uuid
var getIntentshit = (
  chatbot_uuid,
  frmTextMsg,
  frmIntent,
  frmResponse,
  frmFilter,
  frmFeedback,
  frmDateStart,
  frmDateEnd
) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getIntentshit`);
    // connect to mariadb/mysql
    let database = new Database();

    //form the SQL here, merge with AND
    let conditions = [];
    let condValues = [];
    if (frmTextMsg != "") {
      conditions.push("txtmsg LIKE ?");
      condValues.push("%" + frmTextMsg + "%");
    }
    if (frmIntent != "") {
      conditions.push("intentName LIKE ?");
      condValues.push("%" + frmIntent + "%");
    }
    if (frmResponse != "") {
      conditions.push("response_json LIKE ?");
      condValues.push("%" + frmResponse + "%");
    }
    if (frmFeedback) {
      conditions.push('feedback = "DOWN" or feedback = "down"');
    }
    if (frmDateStart != "") {
      conditions.push("timing >= ?");
      condValues.push(frmDateStart);
    }
    if (frmDateEnd != "") {
      conditions.push("timing <= ?");
      condValues.push(frmDateEnd + " 23:59:59");
    }

    if (frmFilter == true) conditions.push("flag = 0");

    conditions =
      conditions.length > 0 ? " AND " + conditions.join(" AND ") : "";

    //console.log('SELECT * FROM intents_hits WHERE uuid=? & txtmsg != "botGetInitialResponseFromChatBot"'+conditions+' ORDER BY timing DESC')
    try {
      // all necessary sql queries
      const sql_queries = [
        //'INSERT INTO intents_hits (uuid, intentName, senderID, txtmsg, sessionID, msgID) VALUES (?, ?, ?, ?, ?, ?)'
        'SELECT * FROM intents_hits WHERE uuid=? AND txtmsg != "botGetInitialResponseFromChatBot"' +
          conditions +
          " ORDER BY timing DESC",
      ];

      // all possible errors
      const db_errors = ["no such intents_hits"];

      // get the chatbots
      let row_chatbots = await database.query(sql_queries[0], [
        chatbot_uuid,
        ...condValues,
      ]);
      if (row_chatbots.length <= 0) {
        throw db_errors[0];
      }

      resolve(row_chatbots);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

var resolveIntents = (ids) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in resolveIntents`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      var sql_queries = [
        "update intents_hits INNER JOIN (select a.id, not b.flag as newflag from intents_hits as a inner join (select * from intents_hits where id=?) as b on a.uuid=b.uuid AND a.intentName=b.intentName AND a.response_json=b.response_json AND a.txtmsg=b.txtmsg) flagtable on intents_hits.id=flagtable.id SET intents_hits.flag = flagtable.newflag",
      ];

      // all possible errors
      const db_errors = ["no such intents_hits"];

      // get the chatbots
      let row_chatbots = await database.query(sql_queries[0], ids);
      if (row_chatbots.length <= 0) {
        throw db_errors[0];
      }

      resolve(row_chatbots);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

// Get intents data for graphing
var getIntentsData = (chatbot_uuid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getIntentsData`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      const sql_queries = [
        "SELECT intentName, count(*) as totalFeedback, count(CASE feedback WHEN 'DOWN' THEN 1 ELSE NULL END) as negativeFeedback FROM intents_hits WHERE uuid=? GROUP BY intentName ORDER BY totalFeedback DESC",
      ];

      // all possible errors
      const db_errors = ["no such intents_hits"];

      // get the chatbots
      let row_chatbots = await database.query(sql_queries[0], [chatbot_uuid]);

      if (row_chatbots.length <= 0) {
        throw db_errors[0];
      }

      resolve(row_chatbots);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

var getTextFromIntentId = (projectname, sessionid, msgid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getTextFromIntentId`);
    let database = new Database();
    try {
      const sql =
        "SELECT txtmsg FROM intents_hits WHERE uuid=? and sessionid=? and msgid=?";
      let dbresult = await database.query(sql, [projectname, sessionid, msgid]);
      resolve(dbresult[0]);
    } catch (e) {
      reject();
    } finally {
      let dbclose = await database.close();
    }
  });
};
// get the intents_hits with Thumb Down
var getIntentshitThumbDown = (chatbot_uuid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getIntentshitThumbDown`);
    // connect to mariadb/mysql
    let database = new Database();
    let strFeedback = "DOWN";

    try {
      // all necessary sql queries
      const sql_queries = [
        //'INSERT INTO intents_hits (uuid, intentName, senderID, txtmsg, sessionID, msgID) VALUES (?, ?, ?, ?, ?, ?)'
        "SELECT * FROM intents_hits WHERE uuid=? AND feedback=?  ORDER BY timing DESC",
      ];

      // all possible errors
      const db_errors = ["no such intents_hits"];

      // get the chatbots
      let row_chatbots = await database.query(sql_queries[0], [
        chatbot_uuid,
        strFeedback,
      ]);

      if (row_chatbots.length <= 0) {
        //throw db_errors[0]
        row_chatbots = [""];
      }

      resolve(row_chatbots);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

// get the chatbot info based on this uuid
var getChatbotInfo = (chatbot_uuid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getChatbotInfo`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      const sql_queries = ["SELECT * FROM chatbot WHERE uuid=?"];

      // all possible errors
      const db_errors = ["no such chatbot project"];

      // get this chatbot
      let row_chatbot = await database.query(sql_queries[0], [chatbot_uuid]);

      if (row_chatbot.length <= 0) {
        throw db_errors[0];
      }

      resolve(row_chatbot);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      // rmb to close the db
      let dbclose = await database.close();
    }
  });
};

// get the live chat info based on this uuid
var getChatbotsInfo = (user_id) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getChatbotsInfo`);
    // connect to mariadb/mysql
    let database = new Database();

    try {
      // all necessary sql queries
      const sql_queries = [
        "select * from chatbot where uuid in (select uuid from chatbot where chatbot.createdby=? UNION select uuid from chatbot_access where chatbot_access.userid=?)",
      ];

      // all possible errors
      const db_errors = ["no such chatbot project"];

      // get the chatbots
      let row_chatbots = await database.query(sql_queries[0], [
        user_id,
        user_id,
      ]);

      if (row_chatbots.length <= 0) {
        throw db_errors[0];
      }

      resolve(row_chatbots);
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

var getCBDatasFromChatbotMore = (lstChatbot_uuid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getCBDatasFromChatbotMore`);
    let database = new Database();
    let conditionQuery = [];
    for (i = 0; i < lstChatbot_uuid.length; i++)
      conditionQuery.push(lstChatbot_uuid[i]); //{ 'uuid': lstChatbot_uuid[i] }
    //let cond = "['"+conditionQuery.join("','")+"']"
    //cond = [cond]
    conditionQuery = [conditionQuery];
    try {
      let findall = await database.query(
        "SELECT payload FROM chatbot_ml_datas WHERE uuid IN (?) and payload is not null",
        conditionQuery
      ); //("+cond+")
      if (findall.length <= 0) {
        findall = [];
      }
      //
      findall = findall.map((row) => {
        return JSON.parse(row.payload);
      });
      resolve(findall);
    } catch (e) {
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};

var getCBDatasFromChatbot = (chatbot_uuid) => {
  return new Promise(async (resolve, reject) => {
    console.log(`in getCBDatasFromChatbot`);
    let database = new Database();
    try {
      let findall = await database.query(
        "SELECT payload FROM chatbot_ml_datas WHERE uuid=?",
        [chatbot_uuid]
      );
      if (findall.length > 0 && findall[0].payload) {
        resolve(JSON.parse(findall[0].payload));
      } else {
        findall = {
          _id: "",
          uuid: chatbot_uuid,
          combinedprojs: [],
          intents: [],
          entities: [],
          actions: [],
          stories: [],
          initialResponse: "",
          mascotInfo: "",
          authAction: "",
          collabs: {},
        };
        resolve(findall);
      }

      // throw 'no such nlu_data, are u sure this is the right chatbot uuid?'
    } catch (e) {
      reject(e.toString());
    } finally {
      let dbclose = await database.close();
    }
  });
};
var getActionFromIntent = async (hitIntent, projectName) => {
  //console.log(`getActionFromIntent: ${hitIntent} ${projectName}`)
  const cbdatas = await retrieveAllCBDatasFromCB(projectName);
  let matchedStory = cbdatas.stories.filter((story) => {
    if (Array.isArray(story.intent)) {
      return filterString(story.intent[0].intent) == filterString(hitIntent);
    } else return filterString(story.intent) == filterString(hitIntent);
  });
  matchedStory = matchedStory[0];
  if (matchedStory) {
    var selectedAction;
    if (Array.isArray(matchedStory.intent))
      selectedAction = matchedStory.intent[0].actions[0];
    else selectedAction = matchedStory.actions[0];
    return selectedAction;
  } else return null;
};

var search_keyword_combproj = async (keyword, projectName) => {
  const cbdatas = await retrieveAllCBDatasFromCB(projectName);
  var foundInt = [];
  cbdatas.intents.forEach((intent) => {
    //for each intent go through each intent.texts and see if the keyword appears as substr
    //return intent.intent if there is a match
    if (
      intent.texts
        .map((txt) => {
          let words = txt.toLowerCase().split(" ");
          return words.includes(keyword);
        })
        .reduce((a, b) => a + b, 0)
    ) {
      var intentStory = null;
      var action = null;
      //look for matching intents using keywords
      //then look for matching stories using intents
      //handle old and new versions of stories
      intentStory = cbdatas.stories.filter((story) => {
        if (typeof story.intent == "string")
          return story.intent == intent.intent;
        //reduce here to merge solutions from multi
        else {
          var storiesfound = story.intent
            .map((strint) => {
              return strint.intent == intent.intent;
            })
            .reduce((a, b) => a + b, 0);
          return storiesfound > 0;
        }
        //else return story.intent[0].intent==intent.intent
      });
      if (intentStory.length > 0) {
        //found stories using this intent
        //console.log("Found a story that contain the intent:"+intent.intent)
        var usedIntent;
        if (typeof intentStory[0].intent == "string")
          usedIntent = intentStory[0];
        else {
          usedIntent = intentStory[0].intent.filter((strint) => {
            return strint.intent == intent.intent;
          });
          usedIntent = usedIntent[0];
        }
        action = usedIntent.actions[0];
      }
      foundInt.push({
        intent: intent.intent,
        action: action || "action_listen",
      });
    }
  });
  return foundInt.length > 0 ? foundInt : null;
};
var retrieveAllCBDatasFromCB = async (chatbot_uuid) => {
  // get the cbdatas from this cb first
  const cbdatas = await getCBDatasFromChatbot(chatbot_uuid);

  if (cbdatas.combinedprojs.length > 0) {
    let combineddatas = { ...cbdatas };
    let allcbqueries = [];

    // need to combined with other projects
    cbdatas.combinedprojs.forEach((extraprojuuid) => {
      allcbqueries.push(
        new Promise(async (resolve, reject) => {
          const otherdatas = await getCBDatasFromChatbot(extraprojuuid);
          resolve(otherdatas);
        })
      );
    });

    // query all of them at the same time
    let allquerieddatas = await Promise.all(allcbqueries);

    // then combined them tgt
    allquerieddatas.forEach((querydatas) => {
      combineddatas.entities.push(...querydatas.entities);
      combineddatas.intents.push(...querydatas.intents);
      combineddatas.actions.push(...querydatas.actions);
      combineddatas.stories.push(...querydatas.stories);
    });

    return combineddatas;
  }

  // 1) if no need, then return the initial cbdatas
  return cbdatas;

  // 2) if need, retrieve other cbdatas and combined it tgt, then return it for training
};

var getRandomInt = (max) => {
  return Math.floor(Math.random() * Math.floor(max));
};

var expressValidateFirst = (req, res, cb) => {
  // checking the results
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // if request datas is incomplete or error, return error msg
    return res.status(422).json({ success: false, errors: errors.mapped() });
  } else {
    cb();
  }
};
function removeUselessWords(str) {
  return str; //10/3/2022: User tried to type "who are you", all filtered and gave invalid response
  var uselessWordsArray = [
    "a",
    "at",
    "be",
    "can",
    "cant",
    "could",
    "couldnt",
    "do",
    "does",
    "how",
    "i",
    "in",
    "is",
    "many",
    "much",
    "of",
    "on",
    "or",
    "should",
    "shouldnt",
    "so",
    "such",
    "the",
    "them",
    "they",
    "to",
    "us",
    "we",
    "what",
    "who",
    "why",
    "with",
    "wont",
    "would",
    "wouldnt",
    "you",
    "br",
    "me",
    "my",
    "myself",
    "our",
    "ours",
    "ourselves",
    "youre",
    "youve",
    "youll",
    "youd",
    "your",
    "yours",
    "yourself",
    "yourselves",
    "he",
    "him",
    "his",
    "himself",
    "she",
    "shes",
    "her",
    "hers",
    "herself",
    "it",
    "its",
    "itself",
    "their",
    "theirs",
    "themselves",
    "which",
    "whom",
    "this",
    "that",
    "thatll",
    "these",
    "those",
    "am",
    "are",
    "was",
    "were",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "did",
    "doing",
    "an",
    "and",
    "but",
    "if",
    "because",
    "as",
    "until",
    "while",
    "by",
    "for",
    "about",
    "against",
    "between",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "from",
    "up",
    "down",
    "out",
    "off",
    "over",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "all",
    "any",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "only",
    "own",
    "same",
    "than",
    "too",
    "very",
    "s",
    "t",
    "will",
    "just",
    "don",
    "dont",
    "shouldve",
    "now",
    "d",
    "ll",
    "m",
    "o",
    "re",
    "ve",
    "y",
    "ain",
    "aren",
    "arent",
    "couldn",
    "didn",
    "didnt",
    "doesn",
    "doesnt",
    "hadn",
    "hadnt",
    "hasn",
    "hasnt",
    "haven",
    "havent",
    "isn",
    "isnt",
    "ma",
    "mightn",
    "mightnt",
    "mustn",
    "mustnt",
    "needn",
    "neednt",
    "shan",
    "shant",
    "shouldn",
    "wasn",
    "wasnt",
    "weren",
    "werent",
    "won",
    "wouldn",
  ];

  var expStr = uselessWordsArray.join("|");

  str = str
    .replace(new RegExp("\\b(" + expStr + ")\\b", "gi"), "")
    .replace(/ +/g, " ")
    .trim();

  return str;
}

function filterString(str) {
  str = str
    .toLowerCase()
    //.replace(/[^\w\s]/gi, '') //removed to support CN characters
    .replace("–", "-")
    .replace("-", "")
    .replace(/ +/g, " ")
    //.replace(/\s+\.(\s|$)/g, '.$1')
    .trim(); //.replace(/ +/g, " ") //remove additional space
  return str;
}

var sendRequest = async (projectName, useraction, events, sender_id) => {
  return await request
    .post("coreengine/executedAct")
    .set("contentType", "application/json; charset=utf-8")
    .set("dataType", "json")
    .send({
      projectName: projectName,
      executed_action: useraction,
      events: null,
      sender_id: sender_id,
    });
};

// chatbot query message
router.post(
  "/talkToChatbot",
  [
    check("text_message", "text_message for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("sender_id", "sender_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("session_id", "session_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(422).json({ success: false, errors: errors.mapped() });

    let projectName = matchedData(req).uuid;
    let filtered_text = filterString(matchedData(req).text_message)
      .replace("–", "-")
      .replace("-", "");
    let text_message = removeUselessWords(filtered_text);
    let sender_id = matchedData(req).sender_id;
    let authToken = req.body.authToken;
    let session_id = matchedData(req).session_id;
    let msg_id = req.body.msgID;
    let nodispatch = req.body.nodispatch || false;
    let savedparams = req.body.savedparams;
    let forwardedIP = getIp(req);
    if (!checkAccess(projectName, forwardedIP)) {
      return res.json({
        returnAct: [
          {
            type: "NOFEEDBACK",
            text: "You do not have access to this chatbot.",
          },
        ],
        initialResponse: "no-access",
        senderIp: forwardedIP,
      });
    }

    try {
      let startmsg = await getIntentFromText(
        projectName,
        text_message,
        sender_id
      );
      let daresult = await getCBDatasFromChatbot(projectName);
      var confLevel = getConfidence(daresult);
      let cbtracker = JSON.parse(startmsg.text);
      sendRequest(projectName, cbtracker.next_action, null, sender_id);
      if (cbtracker.error) throw cbtracker.error;
      /*if(["action_listen","utter_action_slot_reset","utter_action_restarted"].includes(cbtracker.next_action)){
			resetExecutedActions(projectName, senderID);
			startmsg = await getIntentFromText(projectName,text_message,sender_id);
            cbtracker = JSON.parse(startmsg.text)
		}*/

      if (cbtracker.tracker.latest_message.intent) {
        cbtracker = await processTextSearch(
          cbtracker,
          confLevel,
          projectName,
          sender_id,
          text_message,
          session_id,
          msg_id,
          daresult,
          nodispatch,
          filtered_text
        );
      }
      //follow up the text search by returning the response
      let useraction = cbtracker.next_action;
      const nlures = cbtracker.tracker;
      //const apiToken = JSON.parse(req.body.apiToken);

      //give low confidence response
      let QRResponse = await getQRForCloseIntents(cbtracker, projectName);

      if (
        Object.keys(QRResponse).length > 1 ||
        cbtracker.tracker.latest_message.intent.confidence <= confLevel ||
        cbtracker.next_action === "action_listen"
      ) {
        let lowConfResp =
          "Sorry, I'm not sure what you mean. Could you rephrase your question or provide more details? You may like to click <Home> to Top FAQ.";
        const cbdatas = await retrieveAllCBDatasFromCB(projectName);
        const cbactions = cbdatas.actions;
        for (let i = 0; i < cbactions.length; i++) {
          if (cbactions[i].name == "youre_not_helpful_action") {
            const allactions = cbactions[i].allActions;
            lowConfResp = allactions[getRandomInt(allactions.length)][0].text;
            break;
          }
        }
        if (cbtracker.tracker.latest_message.intent.confidence <= confLevel)
          res.json({ returnAct: [{ type: "TEXT", text: lowConfResp }] });
        else
          res.json({
            returnAct: [{ type: "TEXT", text: lowConfResp }, QRResponse],
          });
        //res.json({ returnAct: [{type: "TEXT", text: lowConfResp}] })
        return false;
      }

      //check if authentication required
      let parentStory = await getStoryFromAction(useraction, projectName);
      if (parentStory.reqAuth && !authToken) {
        //return authentication action instead
        if (daresult.authAction) useraction = daresult.authAction;
      }

      var events = null;
      if (
        useraction == "utter_action_slot_reset" ||
        useraction == "utter_action_restarted"
      ) {
        if (useraction == "utter_action_slot_reset") events = "reset_slots";
        if (useraction == "utter_action_restarted") events = "restart";
        sendRequest(projectName, useraction, events, sender_id);
        res.json({
          returnAct: [
            {
              type: "TEXT",
              text:
                "This seems to be a separate new query compared to your previous query. Please repeat your question.",
            },
          ],
        });
        return false;
      }

      let workparallels = await getActionFromText(
        useraction,
        projectName,
        false
      );
      let responses = await processAction(
        workparallels,
        useraction,
        filtered_text,
        savedparams,
        authToken
      );

      const returnAct = [...workparallels, ...responses];
      res.json({ returnAct: returnAct });
      return false;
    } catch (error) {
      console.log(error);
      res.json({ error: error.toString() });
      return false;
    }
    res.json({ error: error.toString() });
    return false;
  }
);

var getActionFromText = async (tm, projectName, filtered = true) => {
  const cbdatas = await retrieveAllCBDatasFromCB(projectName);
  const cbactions = cbdatas.actions;
  for (let i = 0; i < cbactions.length; i++) {
    //let actionName = cbactions[i].name.replace("–", "-")
    //console.log(`${filtered} ${actionName} VS ${tm}`)
    //if(filtered) actionName = filterString(cbactions[i].name).replace("–", "-")
    let actionName = filterString(cbactions[i].name).replace("–", "-");
    tm = filterString(tm).replace("–", "-");
    if (actionName == tm) {
      const allactions = cbactions[i].allActions;
      return allactions[getRandomInt(allactions.length)];
      break;
    }
  }
  return false;
};

var getStoryFromAction = async (actionName, projectName) => {
  console.log(`In getStoryFromAction:`);
  const cbdatas = await retrieveAllCBDatasFromCB(projectName);
  const cbstories = cbdatas.stories;
  for (let i = 0; i < cbstories.length; i++) {
    //check if action is in stories.intent.actions
    let validFormat =
      cbstories[i] && cbstories[i].intent[0] && cbstories[i].intent[0].actions;
    if (validFormat) {
      let foundAction = cbstories[i].intent[0].actions.filter((action) => {
        return filterString(actionName) === filterString(action);
      });
      if (foundAction.length > 0) {
        return cbstories[i];
      }
    }
  }
  return false;
};
var processAction = async (
  workparallels,
  text_message,
  userinput,
  savedparams = {},
  authToken
) => {
  let filteredAct = null;
  filteredAct = workparallels.filter((eachact) => {
    return ["WH", "CWH"].includes(eachact.type);
  });
  let responses = [];
  //duckling
  //let ducklingRes = {};
  /*if(filteredAct.length>0){
		ducklingRes = await request.post('duckling:8000/parse')
			//.set('Content-Type', 'application/json')
			//.query({ format: 'json' })
			//.query({ "text": userinput })
			//.send({ "locale":"en_GB","text": userinput })
		.send("text="+userinput)
		.then(res=>{
			return res.body;
		},error => {
		  return [
			  {type:"TEXT",text:"Callback error encountered."},
			  {type:"TEXT",text:JSON.stringify(error)},
		  ]
		});
	}*/

  for (var i = 0; i < filteredAct.length; i++) {
    let action = filteredAct[i];
    if (action.fieldNames.length <= 0) {
      switch (action.type) {
        case "WH":
          let webhookResponse = await callExternalWebhook(
            action,
            authToken,
            {},
            savedparams
          );
          responses = [...responses, ...webhookResponse.returnAct];
          break;
        default:
          break;
      }
    }
  }

  return responses;
};

//Get only an action response
router.post(
  "/getActionChatbot",
  [
    check("text_message", "action for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    //check('apiToken', 'apiToken for the chatbot query is missing').exists().isLength({ min: 1 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(422).json({ success: false, errors: errors.mapped() });

    let projectName = matchedData(req).uuid;
    let useraction = matchedData(req).text_message;
    //let authToken = matchedData(req).authToken
    let userinput = req.body.userinput;
    let savedparams = req.body.savedparams;
    let daresult = await getCBDatasFromChatbot(projectName);
    let authToken = req.body.authToken;

    try {
      console.log(`In getActionChatbot`);

      //check if authentication required
      let parentStory = await getStoryFromAction(useraction, projectName);
      if (parentStory.reqAuth && !authToken) {
        //return authentication action instead
        console.log(daresult);
        if (daresult.authAction) useraction = daresult.authAction;
      }
      let workparallels = await getActionFromText(
        useraction,
        projectName,
        false
      );
      if (!workparallels) {
        //let text_message = removeUselessWords(text_message)
        //getIntentFromText(uuid,text_message,authToken)
        const returnAct = [...workparallels];
        res.json({ returnAct: returnAct });
      } else {
        let responses = await processAction(
          workparallels,
          useraction,
          userinput,
          savedparams,
          authToken
        );
        const returnAct = [...workparallels, ...responses];
        res.json({ returnAct: returnAct });
        return false;
      }
    } catch (error) {
      res.json({ error: error.toString() });
      return false;
    }
  }
);
var getConfidence = (daresult) => {
  return daresult.confLevel || process.env.confidentLevel;
};

var getIntentFromText = async (projectName, text_message, sender_id) => {
  let startmsg = await request
    .post("coreengine/startmsg")
    .set("contentType", "application/json; charset=utf-8")
    .set("dataType", "json")
    .send({
      projectName: projectName,
      text_message: text_message,
      sender_id: sender_id,
    });
  return startmsg;
};

var resetExecutedActions = async (projectName, sender_id) => {
  await request
    .post("coreengine/executedAct")
    .set("contentType", "application/json; charset=utf-8")
    .set("dataType", "json")
    .send({
      projectName: projectName,
      executed_action: "action_listen", //cbtracker.next_action,
      events: "reset_slots",
      sender_id: sender_id,
    });
};

function getStandardDeviation(array) {
  if (!array || array.length === 0) {
    return 0;
  }
  const n = array.length;
  const mean = array.reduce((a, b) => a + b) / n;
  return {
    mean: mean,
    stddev: Math.sqrt(
      array.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n
    ),
  };
}

var getExamplesFromIntent = async (intentName, projectName) => {
  let cbdatas = await retrieveAllCBDatasFromCB(projectName);
  let chatbotIntents = cbdatas.intents;
  let selectedIntents = chatbotIntents.filter((intent) => {
    return filterString(intent.intent) == filterString(intentName);
  });
  return selectedIntents[0].texts;
};

var getQRForCloseIntents = async (cbtracker, projectName) => {
  var selectedIntent = null;
  let rankings = cbtracker.tracker.latest_message.intent_ranking;
  if (!rankings) return {};
  let confidence = rankings.map((rank) => {
    return rank.confidence;
  });
  let { mean, stddev } = getStandardDeviation(confidence);
  let confidenceCutoff = rankings[0].confidence - stddev / 2;
  let filteredRankings = rankings.filter((rank) => {
    return rank.confidence >= confidenceCutoff;
  });
  //generate QR
  let QR = [];
  if (filteredRankings.length >= 2) {
    for (var i = 0; i < filteredRankings.length; i++) {
      let currRank = filteredRankings[i];
      let intentName = currRank.name;
      let examples = await getExamplesFromIntent(intentName, projectName);
      let intentAction = await getActionFromIntent(intentName, projectName);
      QR.push({ text: examples[0], payload: intentAction });
    }
  } else return {};
  return { type: "QR", buttons: QR };
};
var processTextSearch = async (
  cbtracker,
  confLevel,
  projectName,
  sender_id,
  text_message,
  session_id,
  msg_id,
  daresult,
  nodispatch,
  filtered_text
) => {
  //perform search using keywords in user's text, if found bump up existing intent scores.
  let splittext = text_message.split(" ");
  let wordstoavoid = ["yes", "no"];
  if (splittext.length <= 1 && !wordstoavoid.includes(splittext[0])) {
    var cbIntentsContainKeyword = await search_keyword_combproj(
      text_message,
      projectName
    );
    if (cbIntentsContainKeyword == null) {
      if (
        !(
          text_message == daresult.initialResponse ||
          text_message == "botgetinitialresponsefromchatbot"
        )
      ) {
        if (nodispatch != true) {
          await updateIntentHit(
            projectName,
            cbtracker.tracker.latest_message.intent.name,
            sender_id,
            filtered_text,
            session_id,
            msg_id,
            cbtracker.next_action
          ); //replaced text_message with filtered_text
        }
      }
      return cbtracker;
    }
    var rankedIntents = cbtracker.tracker.latest_message.intent_ranking;
    let confidence = rankedIntents.map((rank) => {
      return rank.confidence;
    });
    let maxConfidence = confidence.reduce((a, b) => {
      return Math.max(a, b);
    });
    let { mean, stddev } = getStandardDeviation(confidence);
    var rankedIntentsDirectory = rankedIntents.map((intent) => {
      //already filtered
      return intent.name;
    });

    for (var i = 0; i < cbIntentsContainKeyword.length; i++) {
      let filteredIntent = filterString(cbIntentsContainKeyword[i].intent)
        .replace("–", "-")
        .replace("-", "");
      if (rankedIntentsDirectory.includes(filteredIntent)) {
        let selectedIntent = rankedIntents.filter((intent) => {
          return intent.name == filteredIntent;
        });
        selectedIntent[0].confidence += maxConfidence + stddev;
        //if(selectedIntent[0].confidence==maxConfidence) selectedIntent[0].confidence += maxConfidence+stddev;
        //else selectedIntent[0].confidence = maxConfidence;
        //selectedIntent[0].confidence = confidence.reduce((a,b)=>{return Math.max(a,b)}),
        selectedIntent[0].boosted = true;
      } else {
        rankedIntents.push({
          name: cbIntentsContainKeyword[i].intent,
          confidence: maxConfidence,
          inserted: true,
        });
      }
    }
    rankedIntents = rankedIntents.sort((a, b) => {
      return b["confidence"] - a["confidence"];
    });
    for (var i = 0; i < rankedIntents.length; i++) {
      rankedIntents[i].action = await getActionFromIntent(
        rankedIntents[i].name,
        projectName
      );
    }

    cbtracker.tracker.latest_message.intent.name = rankedIntents[0].name;
    cbtracker.tracker.latest_message.intent.confidence =
      rankedIntents[0].confidence;
    cbtracker.next_action = rankedIntents[0].action;
  }

  if (
    !(
      text_message == daresult.initialResponse ||
      text_message == "botgetinitialresponsefromchatbot"
    )
  ) {
    if (nodispatch != true) {
      await updateIntentHit(
        projectName,
        cbtracker.tracker.latest_message.intent.name,
        sender_id,
        filtered_text,
        session_id,
        msg_id,
        cbtracker.next_action
      ); //replaced text_message with filtered_text
    }
  }
  return cbtracker;
};
// Get a response from text message
router.post(
  "/query",
  [
    check("text_message", "text_message for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("sender_id", "sender_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("session_id", "session_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(422).json({ success: false, errors: errors.mapped() });
    else {
      let projectName = matchedData(req).uuid;
      let filtered_text = filterString(matchedData(req).text_message)
        .replace("–", "-")
        .replace("-", "");
      let text_message = removeUselessWords(filtered_text);
      //.replace(/[^\w\s]/gi, '').toLowerCase().trim();
      let sender_id = matchedData(req).sender_id;
      let session_id = matchedData(req).session_id;
      let msg_id = req.body.msgID;
      let nodispatch = req.body.nodispatch || true;

      try {
        let startmsg = await getIntentFromText(
          projectName,
          text_message,
          sender_id
        );
        let daresult = await getCBDatasFromChatbot(projectName);
        var confLevel = getConfidence(daresult);

        let cbtracker = JSON.parse(startmsg.text);
        if (cbtracker.error) throw cbtracker.error;
        if (
          [
            "action_listen",
            "utter_action_slot_reset",
            "utter_action_restarted",
          ].includes(cbtracker.next_action)
        ) {
          resetExecutedActions(projectName, sender_id);
          //try query again
          startmsg = await getIntentFromText(
            projectName,
            text_message,
            sender_id
          );
          cbtracker = JSON.parse(startmsg.text);
        }

        //post query processing: keyword search, confidence checking
        if (cbtracker.tracker.latest_message.intent) {
          cbtracker = await processTextSearch(
            cbtracker,
            confLevel,
            projectName,
            sender_id,
            text_message,
            session_id,
            msg_id,
            daresult,
            nodispatch,
            filtered_text
          );
        }

        cbtracker.tracker.latest_message.filtered_text = filtered_text;

        res.json({
          ...cbtracker,
          initialResponse: daresult.initialResponse,
          mascotInfo: daresult.mascotInfo,
          maxconf: confLevel,
        });
        return false;
      } catch (error) {
        console.log(error);
        res.json({ error: error.toString() });
      }
    }
  }
);

var getIp = (req) => {
  var forwardedIP =
    (req.headers["x-forwarded-for"] || "").split(",").pop().trim() ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.connection.socket.remoteAddress;
  console.log("Check IP:" + forwardedIP);
  forwardedIP = forwardedIP.split(":");
  if (forwardedIP) forwardedIP = forwardedIP.pop();
  else forwardedIP = "";
  console.log("Returned IP:" + forwardedIP);
  return forwardedIP;
};

var checkAccess = (projectName, forwardedIP) => {
  projectName = projectName.toLowerCase();
  if (projectName === "rws") {
    return ipRangeCheck(forwardedIP, [
      "203.125.128.250",
      "203.125.128.251",
      "203.125.128.252",
      "115.42.165.69/28",
      "61.8.196.221/28",
      "165.225.113.0/24",
      "165.225.112.0/24",
      "192.168.1.0/24",
      "103.246.37.0/24",
      "148.64.3.0/24",
      "168.149.150.0/24",
    ]);
  }
  return true;
};

router.post(
  "/helloChatbot",
  [
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("sender_id", "sender_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("session_id", "session_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    let projectName = matchedData(req).uuid;
    let sender_id = matchedData(req).sender_id;
    let session_id = matchedData(req).session_id;

    let forwardedIP = getIp(req);
    if (!checkAccess(projectName, forwardedIP)) {
      return res.json({
        success: false,
        errors: "You do not have access to this chatbot.",
        returnAct: [
          {
            type: "NOFEEDBACK",
            text: "You do not have access to this chatbot.",
          },
        ],
        initialResponse: "no-access",
        senderIp: forwardedIP,
      });
    }

    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty())
      return res.status(422).json({ success: false, errors: errors.mapped() });

    let nodispatch = req.body.nodispatch || false;

    try {
      let daresult = await getCBDatasFromChatbot(projectName);
      let useraction = daresult.initialResponse;
      const cbactions = daresult.actions;
      var confLevel = daresult.confLevel || process.env.confidentLevel;

      const workparallels = await new Promise(async (resolve, reject) => {
        try {
          for (let i = 0; i < cbactions.length; i++) {
            if (cbactions[i].name.replace("–", "-") == useraction) {
              const allactions = cbactions[i].allActions;
              resolve(allactions[getRandomInt(allactions.length)]);
              break;
            }
          }
        } catch (e) {
          reject(e.toString());
        }
      });

      res.json({
        returnAct: workparallels,
        initialResponse: daresult.initialResponse,
        mascotInfo: daresult.mascotInfo,
        maxconf: confLevel,
        senderIp: forwardedIP,
      });
      return false;
    } catch (error) {
      res.json({ error: error.toString() });
    }
  }
);

//sending a response from a form
router.post(
  "/sendresponse",
  [
    check("fulfilmentText", "fulfilmentText for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("formresponse", "formresponse for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("sender_id", "sender_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("session_id", "session_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req);
    let fulfilmentText = matchedData(req).fulfilmentText;
    let formresponse = matchedData(req).formresponse;
    let sender_id = matchedData(req).sender_id;

    formresponse = JSON.parse(formresponse);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      //let resp = webHookHelper.executeWebHook(fulfilmentText, {'formresponse':formresponse});//, slots, apiToken);
      let wh = webHookHelper.executeWebHook(fulfilmentText);
      let resp = wh(formresponse).then((resp) => {
        res.json({ returnAct: resp, success: true });
      });
    }
  }
);

router.post(
  "/askgoogle",
  [
    check("query", "query for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    let query = matchedData(req).query;

    request
      .post("coreengine/askgoogle")
      .set("contentType", "application/json; charset=utf-8")
      .set("dataType", "json")
      .send({
        query: query,
      })
      .then((beres) => {
        if (JSON.parse(beres.text).success == false) {
          return res.json({ success: false, msg: "No results found." });
        }
        return res.json({ success: true, msg: JSON.parse(beres.text).msg });
      })
      .catch((error) => {
        return res.json({ success: false, msg: "No results found." });
      });
  }
);

const callExternalWebhook = async (action, authToken, payload, store) => {
  /*************************************************
   * AuthToken - "user's key"
   * payload = { user form input }
   * store = { previously saved data }
   * action = { contains info for calling webhook }
   *
   *
   **************************************************/

  let storeData =
    action.storeFields &&
    action.storeFields.map((field) => {
      return { [field]: store[field] };
    });

  let param = {
    ...payload,
    ...storeData,
  };

  let url = action.serviceLink;
  let method = action.method;

  let response = {};
  if (method == "POST") {
    response = await request
      .post(url)
      .auth(authToken, { type: "bearer" })
      .set("Access-Control-Allow-Origin", "*")
      .set("contentType", "application/json; charset=utf-8")
      .set("dataType", "json")
      .send(param)
      .then((beres) => {
        return beres;
      })
      .catch((error) => {
        return { error: error.toString() };
      });
  } else if (method == "GET") {
    response = await request
      .get(url)
      .auth(authToken, { type: "bearer" })
      .set("Access-Control-Allow-Origin", "*")
      .query(param)
      .then((beres) => {
        return beres;
      })
      .catch((error) => {
        return { error: error.toString() };
      });
  }

  const leaf = (obj, path) =>
    path.split(".").reduce((value, el) => value && value[el], obj);

  let whresult = response.body;
  if (!whresult) return response;
  let returnAct = { next_action: null, returnAct: [], success: true };

  //if auth token is available, save it
  if (whresult.data && whresult.data.token)
    returnAct.returnAct.push({
      type: "AUTH",
      payload: { token: whresult.data.token },
    });

  //console.log(`action output: ${action.output}`)
  if (action.output) {
    let r = leaf(whresult, action.output);
    //console.log(`field output: ${JSON.stringify(r)}`)
    if (Array.isArray(r)) {
      for (const i of r) {
        let t = "";
        for (const key in i) t += `<b>${key}</b>:${i[key]}<br/>`;
        returnAct.returnAct.push({
          type: "TEXT",
          text: `<div class='ui secondary segment'>${t}</div>`,
        });
      }
    } else
      returnAct.returnAct.push({
        type: "TEXT",
        text: `<div class='ui secondary segment'>${JSON.stringify(r)}</div>`,
      });
  } else if (whresult.message)
    returnAct.returnAct.push({ type: "TEXT", text: whresult.message });

  //save the entire response
  for (const sf of action.storeNames) {
    try {
      returnAct.returnAct.push({
        type: "STORE",
        keypair: { [sf.mapas]: leaf(whresult, sf.mapfield) },
      });
    } catch (e) {
      console.log(e);
    }
  }

  return returnAct;
};

router.post(
  "/callExternalWebhook",
  [
    check("payload", "payload required to call external webhooks")
      .exists()
      .isLength({ min: 1 }),
    check("action", "action required to call external webhooks").exists(),
    //check('url', 'url required to call external webhooks').exists().isLength({ min: 1 })
  ],
  async (req, res) => {
    let action = matchedData(req).action;
    let authToken = req.body.authToken;
    let payload = matchedData(req).payload;
    let savedData = req.body.savedData;

    console.log(`In callExternalWebhook: ${payload}`);
    console.log(`In callExternalWebhook: ${authToken}`);
    console.log(`In callExternalWebhook: ${savedData}`);

    try {
      let r = await callExternalWebhook(action, authToken, payload, savedData);
      return res.json(r);
    } catch (e) {
      res.json({ error: "callExternalWebhook failed." });
    }
  }
);

//Update Bot Message Response post
router.post(
  "/botmsgresponse",
  [
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("session_id", "session_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("msgID", "msgID for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      let projectName = matchedData(req).uuid;
      let botMsgResponse = req.body.msgResponse;
      let msg_id = matchedData(req).msgID;
      let session_id = matchedData(req).session_id;
      // console.log(matchedData(req))
      //  console.log(req.body)
      try {
        //17062020: replaced with actionName during insert
        //await updateMessageResponse(botMsgResponse, projectName, session_id, msg_id)

        return res.json({
          success: true,
          errors: { jwt: "Update botmsgresponse successfully" },
        });
      } catch (error) {
        res.json({ error: error.toString() });
      }
    }
  }
);

// Update Feedback Post
router.post(
  "/feedback",
  [
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("session_id", "session_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("msgID", "msgID for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      let projectName = matchedData(req).uuid;
      let feedback_msg = filterString(req.body.feedback);
      let msg_id = matchedData(req).msgID;
      let session_id = matchedData(req).session_id;
      const DOWNVOTE = "cbsystem_downvoted_examples";
      try {
        let activities = [];
        activities.push(
          new Promise(async (resolve, reject) => {
            try {
              const cbdatas = await retrieveAllCBDatasFromCB(projectName);
              const cbactions = cbdatas.actions;
              for (let i = 0; i < cbactions.length; i++) {
                if (cbactions[i].name == "feedback_" + feedback_msg) {
                  const allactions = cbactions[i].allActions;
                  resolve(allactions[getRandomInt(allactions.length)]);
                  break;
                }
              }
              resolve([
                { type: "NOFEEDBACK", text: "Thanks for your feedback!" },
              ]);
            } catch (e) {
              console.log("Error at returning response");
              reject(e.toString());
            }
          })
        );
        activities.push(
          new Promise(async (resolve, reject) => {
            try {
              await updateFeedback(
                feedback_msg,
                projectName,
                session_id,
                msg_id
              );
              resolve(true);
            } catch (e) {
              console.log("Error at updating feedback into db");
              reject(e.toString());
            }
          })
        );

        activities.push(
          new Promise(async (resolve, reject) => {
            try {
              if (feedback_msg.toLowerCase() === "up") {
                resolve("Nothing to update");
                return;
              }
              let intentText = await getTextFromIntentId(
                projectName,
                session_id,
                msg_id
              );
              if (!intentText) {
                resolve("No data");
                return;
              }
              intentText = intentText.txtmsg;
              //if(intentText.length===0){resolve("No data with msg_id found.")}
              let cbdata = await getCBDatasFromChatbot(projectName);
              let storieslist = cbdata.stories.map((story) => {
                return story.name;
              });
              if (!storieslist.includes(DOWNVOTE)) {
                cbdata.stories.push({
                  name: DOWNVOTE,
                  wait_checkpoint: "",
                  intent: [
                    {
                      intent: DOWNVOTE,
                      intentConditions: [],
                      actions: [DOWNVOTE],
                    },
                  ],
                  return_checkpoint: "",
                  defStory: false,
                });
                cbdata.intents.push({
                  intent: DOWNVOTE,
                  entities: [],
                  texts: ["lorem ipsum dolor", intentText],
                });
                cbdata.actions.push({
                  name: DOWNVOTE,
                  allActions: [
                    [
                      {
                        type: "TEXT",
                        text: "I am sorry but I do not understand that.",
                      },
                    ],
                  ],
                });
              } else {
                //insert into the payload the example !may need to filter name
                for (i in cbdata.intents) {
                  if (cbdata.intents[i].intent == DOWNVOTE) {
                    if (!cbdata.intents[i].texts.includes(intentText))
                      cbdata.intents[i].texts.push(intentText);
                    break;
                  }
                }
              }
              //update the database

              await updateCBDatasForChatbot(projectName, cbdata)
                .then((result) => {
                  resolve({ success: true, result: result });
                })
                .catch((error) => {
                  reject({ success: false, errors: error });
                });
            } catch (e) {
              console.log("Error at inserting into intents");
              reject(e.toString());
            }
          })
        );

        const updatefeedback = await Promise.all(activities);
        return res.json({ success: true, returnAct: [...updatefeedback[0]] });
      } catch (error) {
        console.log(error);
        res.json({ error: error.toString() });
      }
    }
  }
);

router.post(
  "/authenticateEmail",
  [
    check("email", "email for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("sender_id", "sender_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    var selectedToken = "n6Avu8RVGLffnp8ghz8PaavD5R6cYzHWRPbQxh26fpCtdqgps";

    res.json({ returnAct: [{ type: "DIR", botToken: selectedToken }] });
  }
);


router.post(
  "/executeAction",
  [
    check("action", "executed_action for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("sender_id", "sender_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("nlures", "nlures data for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("apiToken", "apiToken for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    res.json({ returnAct: { type: "TEXT", text: "This API is unavailable." } });
    return false;

    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      const projectName = matchedData(req).uuid;
      const useraction = filterString(matchedData(req).action).replace(
        "–",
        "-"
      );
      const sender_id = matchedData(req).sender_id;
      const nlures =
        matchedData(req).nlures == "admin"
          ? null
          : JSON.parse(matchedData(req).nlures);
      const apiToken =
        matchedData(req).apiToken == "admin"
          ? null
          : JSON.parse(matchedData(req).apiToken);
      const slots =
        req.body.slots == "admin" ? null : JSON.parse(req.body.slots);
      try {
        if (useraction == "action_listen") {
          res.json({
            returnAct: [
              {
                type: "TEXT",
                text:
                  "Sorry, I'm not sure what you mean. Could you rephrase your question or provide more details? You may like to click <Home> to Top FAQ.",
              },
            ],
          });
          return false;
        }

        var events = null;
        if (
          useraction == "utter_action_slot_reset" ||
          useraction == "utter_action_restarted"
        ) {
          if (useraction == "utter_action_slot_reset") events = "reset_slots";
          if (useraction == "utter_action_restarted") events = "restart";
          await request
            .post("coreengine/executedAct")
            .set("contentType", "application/json; charset=utf-8")
            .set("dataType", "json")
            .send({
              projectName: projectName,
              executed_action: useraction,
              events: events,
              sender_id: sender_id,
            });
          res.json({
            returnAct: [
              {
                type: "TEXT",
                text:
                  "This seems to be a separate new query compared to your previous query. Please repeat your question.",
              },
            ],
          });
          return false;
        }

        let activities = [];
        activities.push(
          new Promise(async (resolve, reject) => {
            try {
              const cbdatas = await retrieveAllCBDatasFromCB(projectName);
              const cbactions = cbdatas.actions;
              for (let i = 0; i < cbactions.length; i++) {
                //console.log(useraction);
                if (
                  filterString(cbactions[i].name).replace("–", "-") ==
                  useraction
                ) {
                  //"utter_"+
                  // randomly choose one of it pls..
                  const allactions = cbactions[i].allActions;
                  resolve(allactions[getRandomInt(allactions.length)]);
                  break;
                }
              }
            } catch (e) {
              reject(e.toString());
            }
          })
        );
        activities.push(
          request
            .post("coreengine/executedAct")
            .set("contentType", "application/json; charset=utf-8")
            .set("dataType", "json")
            .send({
              projectName: projectName,
              executed_action: useraction,
              events: events,
              sender_id: sender_id,
            })
        );
        const workparallels = await Promise.all(activities);

        nextAct = JSON.parse(workparallels[1].text);
        if (
          nextAct.next_action == "utter_action_slot_reset" ||
          nextAct.next_action == "utter_action_restarted"
        ) {
          //if query triggers action_listen, going to reset the slots
          console.log("reset encountered, performing reset:");
          await request
            .post("coreengine/executedAct")
            .set("contentType", "application/json; charset=utf-8")
            .set("dataType", "json")
            .send({
              projectName: projectName,
              executed_action: nextAct.next_action,
              events: "reset_slots",
              sender_id: sender_id,
            });
        }

        let filteredAct = null;
        filteredAct = workparallels[0].filter((eachact) => {
          return ["WH", "CWH"].includes(eachact.type);
        });
        let responses = []; //...workparallels[0]

        for (var i = 0; i < filteredAct.length; i++) {
          let action = filteredAct[i];
          switch (action.type) {
            case "WH":
              console.log("In old callback webhook");
              //old webhooks uses external JS

              let wh = webHookHelper.executeWebHook(
                action.serviceLink,
                slots,
                apiToken
              );
              let resp = await wh(slots, apiToken);
              if (resp) responses = [...resp];

              break;
            case "CWH":
              console.log("In new callback webhook");
              /*For new callback, expected return format APIs:
					
					{'payload':[
					{type:"TEXT",text:'Please answer the security question:',"nodispatch":false},
					{type:"RSP",prompt:res.Data.SecurityQns,text:'fr_checkSecurityQuestion',"nodispatch":false},
					{type:"STORE",keypair:{'adid':adid}},
					{type:"STORE",keypair:{'TransID':res.Data.TransID}}
					]};
					
					Expects an array of response objects.
					
					*/
              let webhookPayload = JSON.parse(action.payload) || {};
              webhookPayload = {
                webhookPayload: webhookPayload,
                nlueresponse: nlures,
              };
              console.log("Sample Payload to WebHook");
              console.log(webhookPayload);
              let callbackRes = await request
                .get(action.serviceLink)
                .set("contentType", "application/json; charset=utf-8")
                .set("dataType", "json")
                .send({
                  query: webhookPayload,
                })
                .then((callbackRes) => {
                  console.log(callbackRes.text.payload);
                  console.log(callbackRes.text);
                  if (Array.isArray(callbackRes.text.payload))
                    return callbackRes.text.payload;
                  else if (callbackRes.text.payload)
                    return [callbackRes.text.payload];
                  else if (callbackRes.text) return [callbackRes.text];
                  else return callbackRes.text;
                })
                .catch((error) => {
                  return [
                    { type: "TEXT", text: "Callback error encountered." },
                    { type: "TEXT", text: JSON.stringify(error) },
                  ];
                });
              console.log("Payload from Webhook");
              console.log(callbackRes);
              responses = [...responses, ...callbackRes];
              break;
            default:
              break;
          }
        }
        const returnAct = [...workparallels[0], ...responses];
        //console.log("Returned to Chatbot")
        //console.log({ returnAct: returnAct })
        // successfully executed the action, return the necessary data back
        res.json({ returnAct: returnAct }); //, result: JSON.parse(workparallels[1].text)
      } catch (error) {
        res.json({ error: error.toString() });
      }
    }
  }
);


router.post(
  "/resolveIntents",
  [check("ids", "ids for the query is missing").exists().isLength({ min: 1 })],
  (req, res) => {
    //var ids = "("+matchedData(req).ids+")";
    resolveIntents(matchedData(req).ids)
      .then((result) => {
        // send the result back to client
        res.setHeader("Content-type", "application/json");
        res.send(JSON.stringify({ success: true, result: result }));
      })
      .catch((error) => {
        return res.status(422).json({ success: false, errors: error });
      });
  }
);

router.post(
  "/testQuery",
  [
    check("text_message", "text_message for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "chatbot uuid for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("sender_id", "sender_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
    check("session_id", "session_id for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  async (req, res) => {
    let projectName = matchedData(req).uuid;
    //let text_message = matchedData(req).text_message.toLowerCase();
    let text_message = filterString(matchedData(req).text_message)
      .replace("–", "-")
      .replace("-", ""); //.replace(/[^\w\s]/gi,
    let sender_id = matchedData(req).sender_id;
    let session_id = matchedData(req).session_id;
    let msg_id = req.body.msgID;

    var data = decodeURIComponent(text_message).split("\n");
    if (data[data.length - 1].length <= 0) data.pop();

    var allPromises = [];
    for (d in data) {
      allPromises.push(
        new Promise(async (resolve, reject) => {
          var q = removeUselessWords(data[d] + "");
          var p = await request
            .post("coreengine/startmsg")
            .set("contentType", "application/json; charset=utf-8")
            .set("dataType", "json")
            .send({
              projectName: projectName,
              text_message: removeUselessWords(data[d]),
              sender_id: sender_id,
            });
          let seg = JSON.parse(p.text).tracker.latest_message.intent;
          seg["query"] = q;
          resolve(seg);
        })
      );
    }

    let all_results = await Promise.all(allPromises);

    var avg = 0;
    var min = all_results[0].confidence;
    var max = all_results[0].confidence;

    for (r in all_results) {
      let c = all_results[r].confidence;
      if (c > max) max = c;
      if (c < min) min = c;
      avg += c;
    }
    avg /= all_results.length;

    res.json({
      success: true,
      result: {
        sum: { max: max, min: min, avg: avg, suggest: (min * 0.8).toFixed(2) },
        result: all_results,
      },
    });
  }
);

// every api router will go through JWT verification first
router.use([check("token", "must have a token").exists()], (req, res, next) => {
  // checking the results
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // if request datas is incomplete or error, return error msg
    return res.status(422).json({ success: false, errors: errors.mapped() });
  } else {
    // get the matched data
    // get the jwt token from body
    let token = matchedData(req).token;

    jwt.verify(token, process.env.jwtSecret, (err, decoded) => {
      if (err) {
        return res.json({
          success: false,
          errors: { jwt: "json web token validate error" },
        });
      } else {
        // Officially trusted this client!
        req.decoded = decoded;
        next();
      }
    });
  }
});

// create a new chatbot project
router.post(
  "/",
  [
    check("name", "must have a name for this chatbot project")
      .exists()
      .isLength({ min: 1 }),
    check("description", "must have a description for this chatbot")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    expressValidateFirst(req, res, () => {
      // base 58 encode it
      let public_uuid = getUUID();

      createNewChatbot({
        user_id: req.decoded.data.i,
        name: matchedData(req).name,
        description: matchedData(req).description,
        uuid: public_uuid,
      })
        .then((result) => {
          // send the result back to client
          res.setHeader("Content-type", "application/json");
          res.send(JSON.stringify({ success: true }));
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    });
  }
);

// delete this a chabot project
router.delete(
  "/",
  [
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    expressValidateFirst(req, res, () => {
      deleteChatbotProject(matchedData(req).uuid)
        .then(() => {
          // send the result back to client
          res.setHeader("Content-type", "application/json");
          res.send(JSON.stringify({ success: true }));
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    });
  }
);

// refresh chatbot uuid
router.post(
  "/refreshUUID",
  [
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      refreshChatbotUUID(matchedData(req).uuid)
        .then(() => {
          // send the result back to client
          res.setHeader("Content-type", "application/json");
          res.send(JSON.stringify({ success: true }));
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    }
  }
);

// get a specific chatbot project info for this user
router.get(
  "/info",
  [
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      getChatbotInfo(matchedData(req).uuid)
        .then((result) => {
          // send the result back to client
          res.setHeader("Content-type", "application/json");
          res.send(JSON.stringify({ success: true, result: result }));
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    }
  }
);

// get all the chatbot projects infos for this user
router.get("/infos", (req, res) => {
  // checking the results
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // if request datas is incomplete or error, return error msg
    return res.status(422).json({ success: false, errors: errors.mapped() });
  } else {
    getChatbotsInfo(req.decoded.data.i)
      .then((results) => {
        // send the result back to client
        res.setHeader("Content-type", "application/json");
        res.send(JSON.stringify({ success: true, result: results }));
      })
      .catch((error) => {
        return res.status(422).json({ success: false, errors: error });
      });
  }
});

// get a specific chatbot Intents_hit info
router.post(
  "/getIntentshitInfo",
  [
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      let frmTextMsg = req.body.frmTextMsg || "";
      let frmIntent = req.body.frmIntent || "";
      let frmResponse = req.body.frmResponse || "";
      let frmFilter = req.body.frmFilter || false;
      let frmFeedback = req.body.frmFeedback || "";
      let frmDateStart = req.body.frmDateStart || "";
      let frmDateEnd = req.body.frmDateEnd || "";

      //console.log(frmTextMsg+','+frmIntent+','+frmResponse+','+frmFilter)

      getIntentshit(
        matchedData(req).uuid,
        frmTextMsg,
        frmIntent,
        frmResponse,
        frmFilter,
        frmFeedback,
        frmDateStart,
        frmDateEnd
      )
        .then((result) => {
          // send the result back to client
          res.setHeader("Content-type", "application/json");
          res.send(JSON.stringify({ success: true, result: result }));
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    }
  }
);

// get a specific chatbot Intents_hit info
router.get(
  "/getIntentsData",
  [
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      getIntentsData(matchedData(req).uuid)
        .then((result) => {
          // send the result back to client
          res.setHeader("Content-type", "application/json");
          res.send(JSON.stringify({ success: true, result: result }));
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    }
  }
);

router.get(
  "/getIntentshitInfoThumbDown",
  [
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      getIntentshitThumbDown(matchedData(req).uuid)
        .then((result) => {
          // send the result back to client
          res.setHeader("Content-type", "application/json");
          res.send(JSON.stringify({ success: true, result: result }));
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    }
  }
);

var updateCBDatasForChatbot = (chatbot_uuid, cbdatas) => {
  console.log(JSON.stringify(cbdatas));
  return new Promise(async (resolve, reject) => {
    console.log(`in updateCBDatasForChatbot`);
    let database = new Database();

    try {
      var re = new RegExp('src="http://', "gi");
      var re2 = new RegExp("http://mailto", "gi");
      for (var ind in cbdatas.actions) {
        var currAct = cbdatas.actions[ind].allActions[0];
        for (var ind2 in currAct) {
          if (currAct[ind2].type == "TEXT") {
            currAct[ind2].text = currAct[ind2].text.replace(
              re,
              'src="viewfile/'
            );
            currAct[ind2].text = currAct[ind2].text.replace(re2, "mailto");
          }
        }
      }

      let payload = JSON.stringify({
        uuid: chatbot_uuid,
        entities: cbdatas.entities,
        intents: cbdatas.intents,
        actions: cbdatas.actions,
        stories: cbdatas.stories,
        combinedprojs: cbdatas.combinedprojs,
        initialResponse: cbdatas.initialResponse,
        mascotInfo: cbdatas.mascotInfo,
        confLevel: cbdatas.confLevel || process.env.confidentLevel,
        cycle: cbdatas.cycle,
        authAction: cbdatas.authAction,
        collabs: cbdatas.collabs,
      });
      //remove all access
      await database.query("DELETE FROM chatbot_access where uuid=?", [
        chatbot_uuid,
      ]);
      //add collaborators
      var emails = [];
      for (collab in cbdatas.collabs) {
        emails.push(cbdatas.collabs[collab]);
        //emails.push("'"+cbdatas.collabs[collab]+"'")
      }
      if (emails.length > 0) {
        await database.query(
          "insert into chatbot_access (uuid,userid) select detable.uuid, detable.id from (SELECT ? as uuid, id from users where email in (?)) as detable",
          [chatbot_uuid, emails]
        );
      }
      let update_chatbot = await database.query(
        "UPDATE chatbot_ml_datas SET payload=? where uuid=?",
        [payload, chatbot_uuid]
      );

      resolve(); //update_chatbot.result
    } catch (e) {
      // reject the error
      reject(e.toString());
    } finally {
      // rmb to close my mongodb collection
      let dbclose = await database.close();
    }
  });
};

var convertToNluDataFormat = (intents, entities) => {
  let rasa_nlu_data = {
    common_examples: [],
    entity_synonyms: [],
    regex_features: [],
  };

  // preparing entity_synonyms
  entities.forEach((entity, index) => {
    entity.values.map((values, vindex) => {
      if (entity.type == "regex") {
        rasa_nlu_data.regex_features.push({
          name: values.name,
          pattern: "(" + values.synonyms[0] + ")",
        });
      } else {
        rasa_nlu_data.entity_synonyms.push({
          value: values.name,
          synonyms: [...values.synonyms],
        });
      }
    });
  });

  //adding the email entity as regex
  email_regex = {
    name: "email",
    pattern: "([a-zA-Z0-9_\\-\\.]+)@([a-zA-Z0-9_\\-\\.]+)\\.([a-zA-Z]{2,5})?",
  };
  //([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})?
  //([a-zA-Z0-9_\\-\\.]+)@([a-zA-Z0-9_\\-\\.]+)\\.([a-zA-Z]{2,5})(\\.([a-zA-Z]{2,5}))?
  rasa_nlu_data.regex_features.push(email_regex);

  // preparing common_examples
  intents.forEach((intent) => {
    const entitiesToSearch = intent.entities;

    intent.texts.map((text) => {
      let entitiesIn = [];

      // find the entities in the text
      entitiesToSearch.forEach((entityToSearch, eindex) => {
        entities.forEach((mainEntity, mindex) => {
          if (entityToSearch === mainEntity.name) {
            mainEntity.values.forEach((mainValue, mvindex) => {
              let rvalue = mainValue.name;

              // first see the value name got match in the text or not
              let start = text.indexOf(rvalue);
              let end = 0;

              if (start >= 0) {
                // match the name..
                end = start + rvalue.length;
                entitiesIn.push({
                  start: start,
                  end: end,
                  value: rvalue,
                  entity: entityToSearch,
                });
              } else {
                // check for synonyms
                const sns = mainValue.synonyms;
                sns.forEach((sn) => {
                  let start = text.indexOf(sn);
                  if (start >= 0) {
                    let end = start + sn.length;
                    entitiesIn.push({
                      start: start,
                      end: end,
                      value: rvalue,
                      entity: entityToSearch,
                    });
                  }
                });
              }
            });
          }
        });
      });
      rasa_nlu_data.common_examples.push({
        text: text,
        intent: filterString(intent.intent.replace("–", "-").replace("-", "")),
        entities: entitiesIn,
      });
    });
  });

  return rasa_nlu_data;
};

var createDefaultScenarios = (stories, entities) => {
  //convert the entities array into a dictionary for easier processing
  let entitiesDictionary = {};
  entities.forEach((entity) => {
    if (entity.type == "categorical") {
      //only want to create stories for categorical types
      entitiesDictionary[entity.name] = entity.values.map((v) => v.name);
    }
  });
  //You will get: entitiesDictionary = {entity_name:[value1,value2,...]}

  //Select stories that has default option enabled
  let newStories = [];
  for (var i in stories) {
    let story = stories[i];
    if (story.defStory) {
      let conditionList = {}; //contains {condition_entity_1:[existing_ent_val_1, existing_ent_val_2, ...]
      //get stories with similar intents
      stories
        .filter((fStory) => {
          return fStory.intent == story.intent;
        })
        .forEach((currStory) => {
          let currCond = currStory.intentConditions[0]; //for this version, only use 1st condition entity to generate stories
          //i.e: if non-default story has more than 2 conditions, this code only generates additional stories for the first condition (where the value is different from this one)
          if (!currCond) return;
          conditionList[currCond.entity] = conditionList[currCond.entity] || [];
          conditionList[currCond.entity].push(currCond.value);
        });
      //You will get: conditionList = {entity_name:[value1,...]}

      for (var condEntity in conditionList) {
        let useDictionary = entitiesDictionary[condEntity];
        if (useDictionary) {
          let existingValues = conditionList[condEntity];
          useDictionary.forEach((value) => {
            if (!existingValues.includes(value)) {
              //go through all possible values for the entity, if not used, create a new story
              //create story
              //let newStory = {...story} //can't use this, only a shallow copy!
              let newStory = JSON.parse(JSON.stringify(story));
              newStory.defStory = false;
              newStory.name += "_" + encodeURIComponent(value);
              newStory.intentConditions.push({
                entity: condEntity,
                value: value,
              });
              newStories.push(newStory);
            }
          });
        }
      }
    }
  }
  //remove all default stories
  stories = stories.filter((fstory) => {
    return !fstory.defStory;
  });
  return [...stories, ...newStories];
};
function lower(obj) {
  for (var prop in obj) {
    if (
      typeof obj[prop] === "string" &&
      !(prop == "intent" || prop == "entities")
    ) {
      obj[prop] = filterString(obj[prop]);
    }
    if (typeof obj[prop] === "object") {
      lower(obj[prop]);
    }
  }
  return obj;
}

var traincb = (cbuuid) => {
  return new Promise(async (resolve, reject) => {
    try {
      // when posted new data, train it straight away
      // get the nlu data first

      let cbdatas = await retrieveAllCBDatasFromCB(cbuuid);
      cbdatas.intents = lower(cbdatas.intents);

      cbdatas.stories = createDefaultScenarios(
        cbdatas.stories,
        cbdatas.entities
      );
      // prepare the domain
      let domain = {
        intents: [],
        actions: [],
        entities: [],
        slots: {},
        regex: {},
        templates: {},
        /*slots: {
            city: { type: 'categorical', values: ['New York City', 'Manhatten City'] }
        },*/
        action_factory: "remote",
        config: { store_entities_as_slots: true },
      };

      /*domain.intents = cbdatas.intents.map((intent) => {
        return {[intent.intent]:{use_entities:false}}
      })*/
      domain.intents = cbdatas.intents.map((intent) => {
        if (intent.texts.length == 0)
          throw "Intent " + intent.intent + " has no training examples.";
        return filterString(intent.intent.replace("–", "-").replace("-", ""));
        /*if(intent.entities&&intent.entities.length>0)
			return {[intent.intent]:{use_entities:true}}
		else
			return {[intent.intent]:{use_entities:false}}*/
      });
      domain.actions = cbdatas.actions /*.filter((action, pos, self)=>{
		 return self.indexOf(action) == pos;
	  })*/
        .map((action) => {
          return filterString(action.name).replace("–", "-"); //"utter_"+
        });
      domain.actions.push("utter_action_slot_reset");
      domain.actions.push("utter_action_restarted");
      //need to remove duplicate entities if combined project, not the best way but prevents bug - Elix
      /*let entities = {};
      cbdatas.entities.forEach((entity)=>{
		 entities[entity.name] = entity || {};
	  }) 
	  console.log(entities);
	  domain.entities = Object.values(entities);
	  */
      domain.entities = cbdatas.entities
        .filter((entity, pos, self) => {
          return self.indexOf(entity) == pos;
        })
        .map((entity) => {
          return entity.name;
        });
      /*domain.entities = cbdatas.entities.map((entity) => {
        return entity.name
	  })*/
      for (var key in cbdatas.entities) {
        let slotType = cbdatas.entities[key].type;
        slotObj =
          slotType == "regex" ? { type: "unfeaturized" } : { type: slotType };
        if (slotType == "categorical") {
          let entity = [...cbdatas.entities[key].values]; //, {name:''}
          slotObj.values = entity.map((val) => val.name);
        }
        domain.slots[cbdatas.entities[key].name] = slotObj;
      }

      let storiesmdstr = "";
      cbdatas.stories.forEach((story) => {
        storiesmdstr += "## " + story.name + "\n";

        if (story.wait_checkpoint) {
          storiesmdstr += "> " + story.wait_checkpoint + "\n";
        }

        //conversion for old versions here
        if (typeof story.intent == "string") {
          let newIntent = [
            {
              intent: story.intent,
              intentConditions: JSON.parse(
                JSON.stringify(story.intentConditions)
              ),
              actions: JSON.parse(JSON.stringify(story.actions)),
            },
          ];
          story.intent = newIntent;
        }

        //loop through stories
        story.intent.forEach((currIntent) => {
          var cleanedIntent = filterString(
            currIntent.intent.replace("–", "-").replace("-", "")
          );
          if (!cleanedIntent || cleanedIntent == "")
            throw "Intent name in story " + story.name + " cannot be empty.";
          storiesmdstr += "* " + cleanedIntent;
          let intentconditionsstr = "";
          if (currIntent.intentConditions.length > 0) {
            intentconditionsstr = "{";
            currIntent.intentConditions.forEach((intentCondition) => {
              if (intentCondition.entity == "" || intentCondition.value == "")
                throw (
                  "Intent condition has empty values in story" +
                  story.name +
                  ", intent" +
                  currIntent.intent
                );
              intentconditionsstr +=
                '"' +
                intentCondition.entity +
                '": "' +
                intentCondition.value +
                '",';
            });
            // remove the last comma
            intentconditionsstr = intentconditionsstr.slice(0, -1);
            intentconditionsstr += "}";
          }
          storiesmdstr += intentconditionsstr + "\n";
          if (currIntent.actions.length == 0)
            throw (
              "Story " +
              story.name +
              " has 0 actions for intent " +
              currIntent.intent
            );
          currIntent.actions.forEach((action) => {
            if (!action || action == "")
              throw (
                "Action is empty in story " +
                story.name +
                ", intent" +
                currIntent.intent
              );
            storiesmdstr +=
              "  - " + filterString(action).replace("–", "-") + "\n"; //utter_
          });
        });

        if (story.return_checkpoint) {
          storiesmdstr += "> " + story.return_checkpoint + "\n";
        }

        storiesmdstr += "\n";
      });

      cbdatas.entities.forEach((entity, index) => {
        entity.values.map((values, vindex) => {
          if (entity.type == "regex") {
            domain.regex[values.name] = values.synonyms[0];
          }
        });
      });

      let newintents = "";
      cbdatas.intents.forEach((intent) => {
        newintents +=
          "## intent:" +
          filterString(intent.intent.replace("–", "-").replace("-", "")) +
          "\n";
        intent.texts.forEach((example) => {
          newintents +=
            "- " +
            filterString(example)
              .replace("–", "-")
              .replace("-", "") +
            "\n";
        });
      });

      //console.log(">>>>>>>>>>>>INTENTS<<<<<<<<<<<<");
      //console.log(JSON.stringify(cbdatas.intents));
      //console.log(">>>>>>>>>>>>ENTITIES<<<<<<<<<<<<");
      //console.log(JSON.stringify(cbdatas.entities));
      // train the nlu first

      for (i in cbdatas.actions) {
        var act = cbdatas.actions[i];
        var str = filterString(act.name).replace("–", "-"); //"utter_"+
        domain.templates[str] = [{ text: '"' + str + '"' }];
      }

      let nludata = convertToNluDataFormat(cbdatas.intents, cbdatas.entities);
      addTrainingToQueue(
        cbuuid,
        domain,
        storiesmdstr,
        newintents,
        nludata,
        parseInt(cbdatas.cycle || 100)
      );

      resolve({
        dialogueTraining: "Added to Queue",
        nluTraining: "Added to Queue",
      }); //dialoguetrainning.body,nlutrainning.body
    } catch (e) {
      // reject the error
      reject(e.toString());
    }
  });
};

// the rest of the api need chatbot uuid in order to do things
router.use(
  [check("uuid", "must have a chatbot uuid").exists()],
  (req, res, next) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      // get the matched data
      // get the uuid from body
      let uuid = matchedData(req).uuid;

      getChatbotInfo(uuid)
        .then((result) => {
          // Officially got the uuid
          req.chatbot_info = result[0];
          next();
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    }
  }
);

// Get a specific chatbot project info via combineproject uuid
router.get(
  "/comprojavaintents",
  [
    check("cbdatas", "cbdatas for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    let cbuuid = req.chatbot_info.uuid;

    getCBDatasFromChatbot(cbuuid)
      .then((result) => {
        if (result.combinedprojs == "") {
          res.json({ success: true, result: result });
        } else {
          getCBDatasFromChatbotMore(result.combinedprojs)
            .then((result) => {
              res.json({ success: true, result: result });
            })
            .catch((error) => {
              return res.status(422).json({ success: false, errors: error });
            });
        }
      })
      .catch((error) => {
        return res.status(423).json({ success: false, errors: error });
      });
  }
);

// get the chatbot datas from this chatbot
router.get("/CBDatas", (req, res) => {
  getCBDatasFromChatbot(req.chatbot_info.uuid)
    .then((result) => {
      res.json({ success: true, result: result });
    })
    .catch((error) => {
      return res.status(422).json({ success: false, errors: error });
    });
});

// post entities, intents, actions and stories cb datas and store it in my mongodb
// and then train the chatbot
router.post(
  "/CBDatas",
  [
    check("cbdatas", "cbdatas for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    expressValidateFirst(req, res, () => {
      // get the cb uuid first
      let cbuuid = req.chatbot_info.uuid;

      /*updateCBDatasForChatbot(
        cbuuid,
        matchedData(req).cbdatas
      ).then((result) => {
		*/
      // after updating the datas.. train the chatbot straight away
      traincb(cbuuid)
        .then((result) => {
          res.json(result);
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });

      /*}).catch((error) => {
        return res.status(422).json({ success: false, errors: error })
      })*/
    });
  }
);

// just save the cbdatas only
router.put(
  "/CBDatas",
  [
    check("cbdatas", "cbdatas for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    expressValidateFirst(req, res, () => {
      // get the cb uuid first
      let cbuuid = matchedData(req).uuid; //chatbot_info

      if (!cbuuid)
        return res
          .status(422)
          .json({ success: false, errors: { msg: "no uuid" } });

      updateCBDatasForChatbot(cbuuid, matchedData(req).cbdatas)
        .then((result) => {
          res.json({ success: true, result: result });
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    });
  }
);

router.put(
  "/CBUpload",
  [
    check("faqData", "faqData for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
    check("chatbotData", "chatbotData for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
    check("uuid", "uuid for the chatbot project is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    expressValidateFirst(req, res, () => {
      // get the cb uuid first
      let cbuuid = matchedData(req).uuid; //chatbot_info

      if (!cbuuid)
        return res
          .status(422)
          .json({ success: false, errors: { msg: "no uuid" } });

      //process

      var data = decodeURIComponent(matchedData(req).faqData).split("\n");
      //add
      if (data[data.length - 1].length > 0) data.push("");
      //console.log(data);

      var intent = {};
      var action = {};
      var story = {};
      var header = "";
      var actionPlaceholder = [];

      var top_most = JSON.parse(matchedData(req).chatbotData);

      function reset(header) {
        actionPlaceholder = [];
        intent = {};
        intent.intent = "";
        intent.entities = [];
        intent.texts = [];

        action = {};

        story = {};
        story.wait_checkpoint = "";
        story.intentConditions = [];
        story.return_checkpoint = "";

        intent.intent = header + "_intent";
        action.name = header + "_action";
        story.name = header + "_story";
        story.intent = intent.intent;
        story.actions = [action.name];
      }

      for (var line in data) {
        var justText = data[line].toLowerCase().split(" ");
        //justText.shift()
        var justText2 = justText.filter(
          (x) => ["i", "a", "to", "my", "if", "your"].indexOf(x) == -1
        ); //!(x=="i"||x=="a"||x=="to"

        justText = justText.join(" ");
        justText2 = justText2.join(" ").replace(/[^0-9a-z\s]/gi, "");
        justText2 =
          justText2.charAt(justText2.length - 1) == "?"
            ? justText2.slice(0, justText2.length - 1)
            : justText2;

        //if first letter is number then it is a Q:
        //if(!isNaN(data[line].charAt(0))){ //new intent
        if (line == 0 || data[line - 1].length == 0) {
          //todo: push the old data into the ..
          let header = data[line]
            .toLowerCase()
            .replace(/[^0-9a-z\s]/gi, "")
            .split(" ")
            .join("_");
          reset(header);

          intent.texts.push(justText);
          intent.texts.push(justText2);
        } else if (data[line].length == 0 || line == data.length - 1) {
          if (Object.keys(intent.texts).length > 0) {
            top_most.intents.push(intent);
            action.allActions = [actionPlaceholder];
            top_most.actions.push(action);
            top_most.stories.push(story);
          }
        } else {
          //is an action
          //action.name = header+"_action";
          if (data[line].substr(0, 4) == "IMG:")
            actionPlaceholder.push({
              type: "IMG",
              image: data[line].substr(4),
            });
          else if (data[line].substr(0, 5) == "FILE:")
            actionPlaceholder.push({
              type: "FILE",
              file: data[line].substr(5),
            });
          else if (data[line].substr(0, 5) == "LINK:")
            actionPlaceholder.push({
              type: "LINK",
              link: data[line].substr(5),
            });
          else if (data[line].substr(0, 3) == "QR:") {
            var splitqr = data[line].substr(3).split(",");
            var buttons = [];
            for (var i in splitqr) {
              buttons.push({ text: splitqr[i], payload: splitqr[i] });
            }
            actionPlaceholder.push({ type: "QR", buttons: buttons });
          } else if (data[line].length)
            actionPlaceholder.push({ type: "TEXT", text: data[line] });
          else continue;
        }
      }

      //console.log(top_most)
      //end process
      updateCBDatasForChatbot(cbuuid, top_most)
        .then((result) => {
          res.json({ success: true, result: result });
        })
        .catch((error) => {
          return res.status(422).json({ success: false, errors: error });
        });
    });
  }
);

// train my dialogue using nlu_data
router.post("/cbtraining", (req, res) => {
  traincb(req.chatbot_info.uuid)
    .then((result) => {
      res.json(result);
    })
    .catch((error) => {
      return res.status(422).json({ success: false, errors: error });
    });
});

// chatbot query message
router.post(
  "/nlucheck",
  [
    check("text_message", "text_message for the chatbot query is missing")
      .exists()
      .isLength({ min: 1 }),
  ],
  (req, res) => {
    // checking the results
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      // if request datas is incomplete or error, return error msg
      return res.status(422).json({ success: false, errors: errors.mapped() });
    } else {
      request
        .get("nluengine:5000/parse")
        .query({
          q: matchedData(req).text_message,
          project: req.chatbot_info.uuid,
          model: "model",
        })
        .end((err, res2) => {
          if (err) {
            res.json({ err: err.toString() });
          }
          let allcbres = res2.body;
          res.json({ allres: allcbres });
        });
    }
  }
);

// dialogue training status
router.post("/nlustatus", (req, res) => {
  // ask for nlu training status
  request.get("nluengine:5000/status").end((err, res2) => {
    if (err) {
      return res.status(422).json({ success: false, errors: err });
    }

    res.json({
      success: true,
      result: res2.body.available_projects[req.chatbot_info.uuid],
    });
  });
});

module.exports = router;
