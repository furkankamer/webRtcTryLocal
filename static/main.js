'use strict';

/****************************************************************************
 * Initial setup
 ****************************************************************************/
var index = 0;

grabWebCamVideo();
var configuration = {
    'iceServers': [{
        'urls': 'stun:stun.l.google.com:19302'
    }],
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
};
var peerConnections = {};
var peerConnectionsStreams = {};
var peerConnectionClient;
var clientId;
//var configuration = null;
var readyOn = 0;
// var roomURL = document.getElementById('url');
var video = document.querySelector('video');
var snapBtn = document.getElementById('snap');
var sendBtn = document.getElementById('send');
var snapAndSendBtn = document.getElementById('snapAndSend');
var videoElem = document.getElementById("videoElem");

// Attach event handlers

// Disable send buttons by default.
sendBtn.disabled = true;
snapAndSendBtn.disabled = true;

// Create a random room if not already present in the URL.
var isInitiator;
var room = window.location.hash.substring(1);
if (!room) {
    room = window.location.hash = randomToken();
}



function grabWebCamVideo() {
    console.log('Getting user media (video) ...');
    navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true
        })
        .then(gotStream)
        .catch(function(e) {
            alert('getUserMedia() error: ' + e);
        });
}

function gotStream(stream) {
    console.log('getUserMedia video stream URL:', stream);
    window.stream = stream; // stream available to console
    video.srcObject = stream;
    video.onloadedmetadata = () =>console.log('gotStream with width and height:',  video.videoWidth, video.videoHeight);
    
    var socket = io.connect();

    socket.on('ipaddr', function(ipaddr) {
        console.log('Server IP address is: ' + ipaddr);
        // updateRoomURL(ipaddr);
    });

    socket.on('created', function(data) {
        isInitiator = true;
        console.log('Created room', data["room"], '- my client ID is', data["id"]);
    });

    socket.on('joined', function(data) {
        clientId = data["id"];
        isInitiator = false;
        console.log('This peer has joined room', data["room"], 'with client ID', data["id"]);
        createPeerConnection(isInitiator, configuration);
    });

    socket.on('full', function(room) {
        alert('Room ' + room + ' is full. We will create a new room for you.');
        window.location.hash = '';
        window.location.reload();
    });

    socket.on('ready', clientId => createPeerConnection(isInitiator, configuration, clientId));

    socket.on('log', function(array) {
        console.log.apply(console, array);
    });

    socket.on('messageToServer', message => {
        if(!isInitiator) console.log("miss messaging detected");
        console.log('Server received message:', message);
        signalingMessageCallback(message["message"],peerConnections[message["id"]],message["id"]);
    });
    socket.on('messageToClient', message => {
        if(isInitiator) console.log("miss messaging detected");
        console.log('Client received message:', message);
        signalingMessageCallback(message,peerConnectionClient);
    })

    // Joining a room.
    socket.emit('create or join', room);

    if (location.hostname.match(/localhost|127\.0\.0/)) {
        socket.emit('ipaddr');
    }

    // Leaving rooms and disconnecting from peers.
    socket.on('disconnect', function(reason) {
        console.log(`Disconnected: ${reason}.`);
        sendBtn.disabled = true;
        snapAndSendBtn.disabled = true;
    });

    socket.on('bye', function(room) {
        console.log(`Peer leaving room ${room}.`);
        sendBtn.disabled = true;
        snapAndSendBtn.disabled = true;
        // If peer did not create the room, re-enter to be creator.
        if (!isInitiator) {
            window.location.reload();
        }
    });

    window.addEventListener('unload', function() {
        console.log(`Unloading window. Notifying peers in ${room}.`);
        socket.emit('bye', room);
    });

    function createPeerConnection(isInitiator, config, clientId = null) {
        var peerConn = new RTCPeerConnection(config);
        if(clientId){
            var clientVideo = document.createElement("video");
            clientVideo.id = String(clientId);
            clientVideo.autoplay = true;
            document.getElementById("videoCanvas").appendChild(clientVideo);
            peerConnections[clientId] = peerConn
        }
        else{
            peerConnectionClient = peerConn;
        }
        console.log('Creating Peer connection as initiator?', isInitiator, 'config:', config);
        peerConn.addEventListener('connectionstatechange', e => {
            console.log(e.target.connectionState);
        });

        // send any ice candidates to the other peer
        peerConn.onicecandidate = e => {
            if (e.candidate) {
                sendMessage({
                    type: 'candidate',
                    label: e.candidate.sdpMLineIndex,
                    id: e.candidate.sdpMid,
                    candidate: e.candidate.candidate
                },clientId);
            } else console.log('End of candidates.');
        };

        peerConn.onnegotiationneeded = () => peerConn.createOffer()
            .then(offer => peerConn.setLocalDescription(offer))
            .then(() => sendMessage(peerConn.localDescription,clientId));

        if (isInitiator) {
            stream.getTracks().forEach(track => peerConn.addTrack(track, stream));
            peerConn.ontrack = e => {
                peerConnectionsStreams[clientId] = e.streams[0];
                document.getElementById(String(clientId)).srcObject = e.streams[0];
                for(const[key,value] of Object.entries(peerConnections))
                    if(key != clientId){
                        e.streams[0].getTracks().forEach(track => value.addTrack(track,e.streams[0]));
                    }
                for(const[key,value] of Object.entries(peerConnectionsStreams)){
                    if(key != clientId)
                        value.getTracks().forEach(track => peerConn.addTrack(track,value));
                }
            }
            console.log('Creating an offer');
        } else {
            setTimeout(() => stream.getTracks().forEach(track => peerConn.addTrack(track, stream)), 1000);
            peerConn.ontrack = e => {
                var clientVideo = document.createElement("video");
                clientVideo.autoplay = true;
                document.getElementById("videoCanvas").appendChild(clientVideo);
                clientVideo.srcObject = e.streams[0];
            }
            
        }
    
    }
    function onLocalSessionCreated(desc,peerConn,clientId = null) {
        console.log('local session created:', desc);
        peerConn.setLocalDescription(desc).then(() => {
            console.log('sending local desc:', peerConn.localDescription);
            sendMessage(peerConn.localDescription,clientId);
        }).catch(logError);
    }
    function signalingMessageCallback(message,peerConn,clientId = null) {
        console.log("callback: " + peerConn);
        if (typeof message !== 'object')
            return;
        if (message.type === 'offer') {
            console.log('Got offer. Sending answer to peer.');
            peerConn.setRemoteDescription(new RTCSessionDescription(message), function() {},
                logError);
            peerConn.createAnswer().then(answer => onLocalSessionCreated(answer,peerConn,clientId))
                    .catch(err => logError(err));

        } else if (message.type === 'answer') {
            console.log('Got answer.');
            peerConn.setRemoteDescription(new RTCSessionDescription(message), function() {},
                logError);

        } else if (message.type === 'candidate') {
            peerConn.addIceCandidate(new RTCIceCandidate({
                candidate: message.candidate,
                sdpMLineIndex: message.label,
                sdpMid: message.id
            }));

        }
    }
    function sendMessage(message,id = null) {
        console.log('Client sending message: ', message);
        if(isInitiator)
            socket.emit('messageToClient', {"message": message,"id": id});
        else
            socket.emit('messageToServer', message);
    }

}

function randomToken() {
    return Math.floor((1 + Math.random()) * 1e16).toString(16).substring(1);
}

function logError(err) {
    if (!err) return;
    if (typeof err === 'string') {
        console.warn(err);
    } else {
        console.warn(err.toString(), err);
    }
}