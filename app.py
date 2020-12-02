import eventlet
eventlet.monkey_patch()
from flask import Flask,flash, request, jsonify, render_template,Response,redirect,send_from_directory, session
import os
import time
from datetime import datetime
from passlib.hash import pbkdf2_sha256
from flask_login import LoginManager, login_user, logout_user, login_required, current_user,UserMixin
from flask_cors import CORS, cross_origin
import psycopg2
import pytz
import random
from flask_socketio import SocketIO, emit, join_room, leave_room
from engineio.payload import Payload
import netifaces as ni

rooms = {}

app = Flask(__name__)
socketio = SocketIO(app)
app.secret_key = b'\xdd\xd6]j\xb0\xcc\xe3mNF{\x14\xaf\xa7\xb9\x18'

@app.route('/')
def index():
    try:
        ni.ifaddresses('eth0')
        ip = ni.ifaddresses('eth0')[ni.AF_INET][0]['addr']
        session["ip"] = ip
    except:
        session["ip"] = request.remote_addr   
    return render_template("index.html")

@socketio.on('messageToClient')
def messageToClient(message):
    print("message to client: %s" % message["id"])
    emit('messageToClient',message["message"],room = message["id"],include_self=False)


@socketio.on('messageToServer')
def message(message):
    print("message to server: %s" % rooms[session["room"]]["host"])
    room = session["room"]
    emit('messageToServer',{"message": message, "id" : request.sid},room = rooms[room]["host"],include_self = False)

@socketio.on('create or join')
def createOrJoin(room):
    session["id"] = request.sid
    if room not in rooms:
        session["room"] = room
        rooms[room] = {}
        rooms[room]["clients"] = []
        rooms[room]["host"] = request.sid
        join_room(room)
        emit('created',{"room" :room, "id": session["id"]})
    elif len(rooms[room]["clients"]) <= 2:
        session["room"] = room
        join_room(room)
        emit('joined',{"room" :room, "id": session["id"], "index": len(rooms[room]["clients"])})
        emit('ready',request.sid,room = rooms[room]["host"],include_self = False)
        rooms[room]["clients"].append(request.sid)
    else:
        emit('full',room)

@socketio.on('ipaddr')
def ipAddr():
    print(session['ip'])
    emit('ipaddr',session['ip'])


@socketio.on('bye')
def bye(room):
    print("bye to room")

if __name__ == "__main__":
    socketio.run(app)