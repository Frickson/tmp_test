const request = require('superagent')

var webHookHelper = {}

webHookHelper.data = {};

const apiBackend = '192.168.1.12';

const resolve_install_conference = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Solutions for conference call installation:"}];
	switch(apiToken.region){
		case 'Hong Kong':
			resp.push({type:"TEXT",text:"Contact HK Helpdesk : 4300 / +64-09 356 4300"});
			break;
		case 'Singapore':
			resp.push({type:"TEXT",text:"Contact SG Helpdesk : 8899 / + 65-6826 8899"});
			break;
		default: return [{type:"TEXT",text:'Invalid operating system.'}];
	}	
	return resp;
}
const resolve_issue_conference = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Solutions for conference call issues:"}];
	switch(apiToken.region){
		case 'Hong Kong':
			resp.push({type:"TEXT",text:"Contact HK Helpdesk : 4300 / +64-09 356 4300"});
			break;
		case 'Singapore':
			resp.push({type:"TEXT",text:"Contact SG Helpdesk : 8899 / + 65-6826 8899"});
			break;
		default: return [{type:"TEXT",text:"As you did not provide a region, you may try to contact SG Helpdesk : 8899 / + 65-6826 8899"}];
	}	
	return resp;
}
const resolve_buy_laptop = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Buy "+slots.topic+" laptop:"}];
	switch(apiToken.region){
		case 'Hong Kong':
			resp.push({type:"LINK",text:"Contact HK Helpdesk : 4300 / +64-09 356 4300"});
			break;
		case 'Singapore':
			resp.push({type:"TEXT",text:"Contact SG Helpdesk : 8899 / + 65-6826 8899"});
			break;
		default: return [{type:"TEXT",text:'Invalid operating system.'}];
	}	
	return resp;
}
const resolve_battery_replacement = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Solutions for battery replacement:"}];
	switch(apiToken.region){
		case 'Hong Kong':
			resp.push({type:"TEXT",text:"Contact HK Helpdesk : 2345 / + 852-2513 2345"});
			break;
		case 'Singapore':
			resp.push({type:"TEXT",text:"Contact SG Helpdesk : 8899 / + 65-6826 8899"});
			break;
		default: return [{type:"TEXT",text:'Invalid operating system.'}];
	}	
	return resp;
}
const resolve_battery_health = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Solutions for battery health"}];
	switch(apiToken.region){
		case 'Hong Kong':
			resp.push({type:"TEXT",text:"Contact HK Helpdesk : 4300 / +64-09 356 4300"});
			break;
		case 'Singapore':
			resp.push({type:"TEXT",text:"Contact SG Helpdesk : 8899 / + 65-6826 8899"});
			break;
		default: return [{type:"TEXT",text:'Invalid operating system.'}];
	}	
	return resp;
}

const resolve_issue_office = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Solutions for  "+apiToken.region+ " for topic "+slots.topic+" and OS "+slots.operatingsys}];
	switch(slots.operatingsys){
		case 'android':
			resp.push({type:"TEXT",text:"Please refer to the following document:"});
			resp.push({type:"LINK",link:"Office365Android.pdf"});
			break;
		case 'ios':
			resp.push({type:"TEXT",text:"Please refer to the following document:"});
			resp.push({type:"LINK",link:"Office365IOS.pdf"});
			break;
		default: return [{type:"TEXT",text:'Unable to assist with the operating system.'}];
	}	
	return resp;
}

const resolve_install_vpn = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Install VPN instructions for region "+apiToken.region+ " and OS "+slots.operatingsys}];
	resp.push({type:"TEXT",text:" Please refer to: https://aka.ms/mfasetup"});
	return resp;
}
const resolve_issue_vpn = async (slots,apiToken) => {
	var resp = [{type:"TEXT",text:"Issue for VPN for region "+apiToken.region+ " and OS "+slots.operatingsys}];
	switch(apiToken.region){
		case 'Hong Kong':
			resp.push({type:"TEXT",text:"Contact HK Helpdesk : 2345 / + 852-2513 2345"});
			break;
		case 'Singapore':
			resp.push({type:"TEXT",text:"Contact SG Helpdesk : 8899 / + 65-6826 8899"});
			break;
		default: return [{type:"TEXT",text:'Invalid operating system.'}];
	}	
	return resp;
}

const testService = async (slots) => {
	if(!slots.time) return [{type:"TEXT",text:'Example: I want to book a meeting room at 10AM'}];
	switch(slots.email){
		case 'ian@sgh.com.sg': return [{type:"TEXT",text:'Booked IAN room at '+slots.time}]; break;
		case null: case '': return [{type:"TEXT",text:'What is your email address? Example: My email is agency@domain.com'}]
		default: return [{type:"TEXT",text:'Meeting room booked under email account '+slots.email+' at '+slots.time}]; break;
	}
	return [{type:"TEXT",text:'The web service has identified your email as:'+JSON.stringify(slots)}]
}

/*const NEHRService = async (slots) => {
	if(!slots.email) return [{type:"TEXT",text:'Email is required to raise ticket.'}];
	let ticket_no = ("000000" + (Math.random()*100000)).substr(-6,6);
	webHookHelper.data["#"+ticket_no] = {status:'IN PROCESS', email:slots.email, organization:slots.organization};
	return [{type:"TEXT",text:'Ticket #'+ticket_no+" with user email "+slots.email+" for "+slots.organization}]
}*/

const setOrg = async (slots) => {
	if(!slots.email) return [{type:"TEXT",text:'No email provided!'}];
	//var domain = slots.email.replace(/@(.*)\./,"");
	var startIn = slots.email.indexOf('@');
	var domain = slots.email.substring(startIn+1,slots.email.indexOf('.',startIn)).toLowerCase();
	return [{type:"EMIT",text:'I am from '+domain,"nodispatch":true}]
	//return {type:"TEXT",text:'Ticket #'+ticket_no+" with user email "+slots.email+" for "+slots.organization}
}

const getFXAuth = async (slots) => {
	if(!slots.email) return {type:"TEXT",text:'No email provided!'};
	//var domain = slots.email.replace(/@(.*)\./,"");
	var startIn = slots.email.indexOf('@');
	var domain = slots.email.substring(startIn+1,slots.email.indexOf('.',startIn));
	return [{type:"EMIT",text:"hello","nodispatch":true}]
	//return {type:"TEXT",text:'Ticket #'+ticket_no+" with user email "+slots.email+" for "+slots.organization}
}

const checkTicketStatus = (slots) => {
	if(webHookHelper.data[slots.ticketid]){
		let ticket = webHookHelper.data[slots.ticketid];
		let response = '';
		if(ticket.email!=slots.email) response += 'Email does not tally.';
		else if(ticket.organization!=slots.organization) response += 'Organization does not tally.';
		else response += 'Ticket '+slots.ticketid+ ' status is '+webHookHelper.data[slots.ticketid].status;
		webHookHelper.data[slots.ticketid].status = 'COMPLETED';
		return [{type:"TEXT",text:response}]
	}
	else
		return [{type:"TEXT",text:'No such ticket.'}]
}
const providedEmail = async (slots) => {
		/*startmsg = await request
					.post('coreengine/startmsg')
					.set('contentType', 'application/json; charset=utf-8')
					.set('dataType', 'json')
					.send({
					  projectName: projectName,
					  text_message: 'i am from sgh',
					  sender_id: sender_id
					})*/
		return [{type:"EMIT",text:'My email is '+slots.email,"nodispatch":true}]
}
/*
async function fxGetCredentials(slots,apiToken) {
	//return [{type:"TEXT",text:"Logging in as special user.","nodispatch":false},{type:"AUTH",payload:{region:"Singapore"}}]
	let res = await request.get('https://'+apiBackend+':8089/api/UserAPIController/GetUserByLoginName?loginName='+apiToken.token)
					.set('contentType', 'application/json; charset=utf-8')
					.catch(()=>null)
	if(res!=null) res = res.body.data;
	if(res&&res.userFullName) return [{type:"TEXT",text:"Welcome "+res.userFullName,"nodispatch":false},{type:"AUTH",payload:res}]
	return [{type:"TEXT",text:"You are not logged in.","nodispatch":false},{type:"AUTH",payload:{region:"Singapore"}}]
}*/

async function fr_checkADID(formresponse) {

		let adid = formresponse.formresponse;
		let res = await request.post(apiBackend)
		.set('contentType', 'application/json; charset=utf-8')
        .set('dataType', 'json')
		.send({
			transID:null,
			securityQns:null,
			securityAns:null,
			otp:null,
			adid:adid,
			serviceType:null,
			action:'VerifyADID'
        });
		res = res.body;
		if(res.IsSuccessful){
			return [
				{type:"TEXT",text:'Please answer the security question:',"nodispatch":false},
				{type:"RSP",prompt:res.Data.SecurityQns,text:'fr_checkSecurityQuestion',"nodispatch":false},
				{type:"STORE",keypair:{'adid':adid}},
				{type:"STORE",keypair:{'TransID':res.Data.TransID}}];
		}else{
			return [{type:"TEXT",text:'ADID check unsuccessful.',"nodispatch":false}]
		}
		
		return res.IsSuccessful;
}

const fr_checkSecurityQuestion = async (formresponse) => {
		let security = formresponse.formresponse;
		let adid = formresponse.adid;
		let TransID = formresponse.TransID;
		
		let res = await request.post(apiBackend)
		.set('contentType', 'application/json; charset=utf-8')
        .set('dataType', 'json')
		.send({
			TransID:TransID,
			securityQns:null,
			securityAns:security,
			otp:null,
			adid:adid,
			serviceType:'Unlock',
			action:'VerifySecurityAns'
        });
		res = res.body;
		if(res.IsSuccessful){
			return [{type:"TEXT",text:'An OTP is sent to your device.',"nodispatch":false},{type:"RSP",prompt:"Please enter OTP number:",text:'fr_sendOTP',"nodispatch":false}];
		}else{
			return [{type:"TEXT",text:'Security Question unsuccessful.',"nodispatch":false}]
		}
} 

const fr_sendOTP = async (formresponse) => {
		let otp = formresponse.formresponse;
		let adid = formresponse.adid;
		let TransID = formresponse.TransID;
		
		let res = await request.post(apiBackend)
		.set('contentType', 'application/json; charset=utf-8')
        .set('dataType', 'json')
		.send({
			TransID:TransID,
			securityQns:null,
			securityAns:null,
			otp:otp,
			adid:adid,
			serviceType:'Unlock',
			action:'VerifyOTP'
        });
		
		res = res.body;
		if(res.IsSuccessful){
			return [{type:"TEXT",text:'Your password is reset',"nodispatch":false}];
		}else{
			return [{type:"TEXT",text:'OTP unsuccessful.',"nodispatch":false}]
		}
} 

function executeWebHook(fulfilmentText, slots, apiToken) {
	switch(fulfilmentText){
		case 'book_room':
			return testService(slots);
			break;
		case 'NEHR_helpdesk':
			//return NEHRService(slots);
			break;
		case 'NEHR_checkTicket':
			return checkTicketStatus(slots);
			break;
		case 'provided_email':
			return providedEmail;
			break;
		case 'determine_org':
			return setOrg;
			break;
			
		case 'fx_get_credentials':
			//return fxGetCredentials;
			break;
			
		//async
		case 'fr_checkADID':
			return fr_checkADID;
			break;
		case 'fr_checkSecurityQuestion':
			return fr_checkSecurityQuestion;
			break;
		case 'fr_sendOTP':
			return fr_sendOTP;
			break;	
			
			
/****************************************/
case 'resolve_issue_vpn':
	return resolve_issue_vpn;
	break;
case 'resolve_install_vpn':
	return resolve_install_vpn;
	break;
case 'resolve_issue_office':
	return resolve_issue_office;
	break;
case 'resolve_battery_health':
	return resolve_battery_health;
	break;
case 'resolve_battery_replacement':
	return resolve_battery_replacement;
	break;
	
case 'resolve_install_conference':
	return resolve_install_conference;
	break;
case 'resolve_issue_conference':
	return resolve_issue_conference;
	break;
case 'resolve_buy_laptop':
	return resolve_buy_laptop;
	break;
	
default:
	return {type:"TEXT",text:"Webservice call success!"}
	}
}

webHookHelper.executeWebHook = executeWebHook;
module.exports = webHookHelper
