
function addCss(fileName) {

  var head = document.head;
  var link = document.createElement("link");

  link.type = "text/css";
  link.rel = "stylesheet";
  link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css";

  head.appendChild(link);
}

function onLoad(){

	var iframe = document.createElement('iframe');
	iframe.src = "https://itchatbot.nec-eportal.com.sg/?botToken="+token;
	Object.assign(iframe.style, {
		height: 0,
		borderWidth:0,
		position : "absolute",
		bottom : 60,
		right : 10,
		//visibility : 'hidden',
		borderRadius: '5px',
		transition: "height 2s"
	});
	
	var button = document.createElement('div');
	var ic = document.createElement('i');
	ic.className="fa fa-commenting fa-2x";
	button.appendChild(ic);
	button.v=-1;
	button.onclick = function(){
		if(this.v==-1){
			iframe.style.height=300;
		}else {
			iframe.style.height='0';
		}
		this.v*=-1;
	}.bind(button);
	button.onmouseover = function(){
		button.style.backgroundColor='#1dc4f2';
	}
	button.onmouseleave = function(){
		button.style.backgroundColor='rgb(4,8,124)';
	}
	Object.assign(button.style, {
		borderRadius: '40px',
		cursor: 'pointer',
		backgroundColor : 'rgb(4,8,124)',
		position : "absolute",
		bottom : 10,
		right : 10,
		height : '40px',
		width : '40px',
		color: '#ffffff',
		textAlign: 'center',
		paddingTop:5,
		transition: 'background-color 0.5s'
	});
	

	var body = document.getElementsByTagName("BODY")[0];
	body.appendChild(button);
	body.appendChild(iframe);

}

window.onload = function(){
addCss();onLoad()	
}