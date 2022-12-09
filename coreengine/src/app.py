import os
from flask import Flask, request, jsonify
import json
import yaml
import shutil
import requests
import urllib
import configparser
from rasa_core.agent import Agent
from rasa_core.policies.keras_policy import KerasPolicy
from rasa_core.policies.memoization import MemoizationPolicy
from rasa_core.featurizers import (MaxHistoryTrackerFeaturizer, BinarySingleStateFeaturizer)
import logging
logging.basicConfig(level=logging.DEBUG)

# init the flask app
app = Flask(__name__)
allagents = {}

#from bs4 import BeautifulSoup;
#import requests
#r  = requests.get("https://www.google.com/search?q=npm").text
#soup = BeautifulSoup(r)
#for content in soup.find_all('span','st'):
#    print(content)

from rasa_core.events import AllSlotsReset
from rasa_core.events import Restarted
from rasa_core.actions import Action
#from rasa_core.events import SlotSet
#class Restarted(Action):
#  def name(self):
#    return 'action_restarted'
#  def run(self, dispatcher, tracker, domain):
#    app.logger.info("All slots reset called!")
#    return[Restarted()]

#class AllSlotsReset(Action):
#  def name(self):
#    return 'action_slot_reset'
#  def run(self, dispatcher, tracker, domain):
#    app.logger.info("All slots reset called!")
#    return[tracker._reset_slots()]

@app.route('/askgoogle', methods=['POST'])
def AskGoogle():
  from bs4 import BeautifulSoup;
  query = request.get_json()['query']
  r  = requests.get("https://www.google.com/search?"+urllib.parse.urlencode({'q':query})).text
  soup = BeautifulSoup(r, 'html.parser')
  elem = soup.find('div',class_='s')#.find('div',class_='g')#.find('div',class_='rc')#.find('div',class_='s')
  #app.logger.info(elem.find('span',class_='st').get_text())
  if(elem and elem.find('span',class_='st')):
    #print(elem.find('a').get('href'))
    #app.logger.info(elem.find('span',class_='st'))
    resu = elem.find('span',class_='st').get_text();
    return jsonify(success=True,msg=resu)#urllib.parse.urlencode({'result':resu})
  else:
    return jsonify(success=False,msg="Google has no answers for this question.")#urllib.parse.urlencode({'result':resu})
    

#version 8/8/2018
class AgentTracker:
  def __init__(self, fileloc, agent):
    app.logger.info("Creating a new agent.")
    self._stamp = os.stat(fileloc).st_mtime
    self._fileloc = fileloc
    self._agent = agent
  def checkStamp(self):
    result = os.stat(self._fileloc).st_mtime==self._stamp
    return result
  def loadNewAgentIfNotOutdated(self,fileloc,nlupath):
    if not self.checkStamp():
      app.logger.info("Agent is outdated. Updating.")
      self._agent = Agent.load(fileloc, nlupath)
      self._stamp = os.stat(fileloc).st_mtime
    else:
      app.logger.info("Agent is the most recent. Not updating.")
  def declareSelf(self):
    app.logger.info("Stamp:"+str(self._stamp))
    app.logger.info("Stamp:"+self._fileloc)
    return str(self._stamp)
  def __delete__(self, instance):
    del self._stamp
    del self._fileloc
    del self._agent

def traindialogue(projectName):
  global allagents
  projectPath = '/app/dialogues/' + projectName
  nluPath = "/nluprojects/" + projectName + "/model" # get the path of nlu model
  tmpstoriesPath = '/usr/' + projectName + '_stories.md' # turn stories into a file
  storiesfile = open(tmpstoriesPath, 'w+')
  storiesfile.write(request.get_json()['stories'])
  storiesfile.close()
  
  newintents = open('/usr/' + projectName + '_nlu.md', 'w+')
  newintents.write(request.get_json()['newintents'])
  newintents.close()
  newintents = open('/usr/' + projectName + '_nlu.json', 'w+')
  newintents.write('{"rasa_nlu_data":'+json.dumps(request.get_json()['nlujson'])+'}')
  newintents.close()
  
  tmpdomainPath = '/usr/' + projectName + '_domain.yml' # turn domain into yml format file
  domainfile = open(tmpdomainPath, 'w+')
  yaml.dump(request.get_json()['domain'], domainfile, default_flow_style=False)

  config = configparser.ConfigParser()
  config.read('app.cfg')

  featurizer = MaxHistoryTrackerFeaturizer(BinarySingleStateFeaturizer(), max_history=int(config['DEFAULT']['KERASH'])) # prepare the agent
  agent = Agent(tmpdomainPath, policies=[MemoizationPolicy(max_history=int(config['DEFAULT']['MEMOH'])),KerasPolicy(featurizer)], interpreter=nluPath) #,KerasPolicy(featurizer)
  agent.train(agent.load_data(tmpstoriesPath),epochs=int(request.get_json()['cycle']))#,validation_split=0.1 #config['DEFAULT']['EPOCHS'])
  agent.persist(projectPath)
  app.logger.info("Training completed.")
  
  #for trainingengine, don't have to hold anyting in the memory
  #tracker = AgentTracker(projectPath,agent)
  #allagents[projectName] = tracker
  #agent.visualize(tmpstoriesPath, output_file="/usr/" + projectName + ".png", max_history=int(config['DEFAULT']['KERASH']), should_merge_nodes=False)
  del agent

@app.route('/training', methods=['POST'])
def training():
  global allagents
  traindialogue(request.get_json()['projectName'])
  return jsonify(success=True, status='ready')

@app.route('/deleteProject', methods=['POST'])
def deleteProject():
  global allagents
  projectName = request.get_json()['projectName']
  allagents.pop(projectName, None)
  # delete the project path
  projectPath = "/app/dialogues/" + projectName
  nluPath = "/nluprojects/" + projectName
  shutil.rmtree(projectPath, True, None)
  shutil.rmtree(nluPath, True, None)
  return jsonify(success=True, status='ready')


@app.route('/startmsg', methods=['POST'])
def startmsg():
  app.logger.info("Start msg:")
  global allagents
  projectName = request.get_json()['projectName']
  dialogue_path = '/app/dialogues/' + projectName
  nlupath = "/nluprojects/" + projectName + "/model"  
  if projectName in allagents:
    app.logger.info("Accessing existing tracker's agent.")
    app.logger.info(dialogue_path)
    app.logger.info(nlupath)
    tracker = allagents[projectName]
    tracker.loadNewAgentIfNotOutdated(dialogue_path, nlupath) #check if file had been updated
    #return jsonify(tracker._agent.handle_text(text_message=request.get_json()['text_message'],sender_id=request.get_json()['sender_id']))
    result = tracker._agent.start_message_handling(text_message=request.get_json()['text_message'], sender_id=request.get_json()['sender_id'])
    result["tracker"]["version"]=tracker.declareSelf();
    return jsonify(result)
  else:
    app.logger.info("Accessing non-existing tracker's agent.")
    if os.path.isdir(dialogue_path): #if directory is there...
      app.logger.info("Offline agent is available. Loading new agent into a new tracker.")
      agent = Agent.load(dialogue_path, nlupath)
      tracker = AgentTracker(dialogue_path,agent)
      allagents[projectName] = tracker
      #return jsonify(tracker._agent.handle_text(text_message=request.get_json()['text_message'],sender_id=request.get_json()['sender_id']))
      result = tracker._agent.start_message_handling(text_message=request.get_json()['text_message'], sender_id=request.get_json()['sender_id'])
      result["tracker"]["version"]=tracker.declareSelf();
      return jsonify(result)
    else:
      app.logger.info("Accessing an agent that does not exist at all")
      return jsonify(error='no such agents')


@app.route('/executedAct', methods=['POST'])
def executedAct():
  app.logger.info("Executed act")
  global allagents
  projectName = request.get_json()['projectName']
  if projectName in allagents:
    tracker = allagents[projectName]
    useEvents = [];
    if request.get_json()['events'] == 'reset_slots':
      useEvents.append(AllSlotsReset());
    if request.get_json()['events'] == 'restart':
      useEvents.append(Restarted());
    #return jsonify(tracker._agent.execute_action(sender_id=request.get_json()['sender_id'],action=request.get_json()['executed_action']))
    return jsonify(tracker._agent.continue_message_handling(sender_id=request.get_json()['sender_id'], executed_action=request.get_json()['executed_action'], events=useEvents));
  else:
    return jsonify(error='no such agents')

#@app.errorhandler(500)
#def internal_error(error):
#  app.logger.info("500 error:"+repr(error))
#  return "500 error"

# run my flask app
if __name__ == '__main__':
  # firstly load all the existing project in my dir fi
  #allprojectsPath = [x[1] for x in os.walk("/app/dialogues")][0]
  #allnlusPath = [y[1] for y in os.walk("/nluprojects/")][0]
  #localcount = 0
  #for projectpath in allprojectsPath:
  #  if projectpath == allnlusPath[localcount]:
  #    allagents[projectpath] = Agent.load("/app/dialogues/" + projectpath, interpreter="/nluprojects/" + projectpath + "/model")
  #  localcount+=1
  #K.clear_session()
  app.debug = True
  app.run(host='0.0.0.0', port=80, debug=True, threaded=False)
