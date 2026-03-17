import express from "express";
import { Server } from "socket.io";
import http from "http";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  const io = new Server(server, {
    cors: {
      origin:[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://quickfoosball.web.app",
        "https://quickfoosball.firebaseapp.com"
      ],
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "O backend QuickFoosball está a correr!" });
  });

  type GameMode = '1v1' | '2v2' | '3v3' | 'solo';
  type Player = { id: string, name: string, team: 1 | 2, role: number };
  type ChatMessage = { sender: string, text: string, team?: 1 | 2, system?: boolean };

  const rooms: Record<string, {
    mode: GameMode;
    status: 'lobby' | 'playing' | 'gameover';
    players: Player[];
    score1: number;
    score2: number;
    resetVotes: Set<string>;
    chat: ChatMessage[];
  }> = {};

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create_room", ({ mode, name }, callback) => {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      socket.join(roomId);
      rooms[roomId] = {
        mode,
        status: mode === 'solo' ? 'playing' : 'lobby',
        players:[{ id: socket.id, name, team: 1, role: 0 }],
        score1: 0, score2: 0, resetVotes: new Set(), chat:[]
      };
      
      const joinMsg = { sender: 'System', text: `${name} criou a sala!`, system: true };
      rooms[roomId].chat.push(joinMsg);

      callback({ success: true, roomId, roomState: rooms[roomId] });
    });

    socket.on("join_room", ({ roomId, name }, callback) => {
      const room = rooms[roomId];
      if (!room) {
        callback({ success: false, message: "Room not found" });
        return;
      }
      const maxPlayers = room.mode === '1v1' || room.mode === 'solo' ? 2 : room.mode === '2v2' ? 4 : 6;
      if (room.players.length >= maxPlayers) {
        callback({ success: false, message: "Room is full" });
        return;
      }
      
      socket.join(roomId);
      let assignedTeam: 1 | 2 = 2;
      let assignedRole = 0;
      const getRoles = (team: 1|2) => room.players.filter(p => p.team === team).map(p => p.role);
      const rolesPerTeam = room.mode === '1v1' || room.mode === 'solo' ? 1 : room.mode === '2v2' ? 2 : 3;
      
      let found = false;
      for (const t of[2, 1] as const) {
        const taken = getRoles(t);
        for (let r = 0; r < rolesPerTeam; r++) {
          if (!taken.includes(r)) {
            assignedTeam = t; assignedRole = r; found = true; break;
          }
        }
        if (found) break;
      }

      room.players.push({ id: socket.id, name, team: assignedTeam, role: assignedRole });
      
      // Mensagem de sistema que o jogador entrou
      const joinMsg = { sender: 'System', text: `${name} juntou-se à partida!`, system: true };
      room.chat.push(joinMsg);
      if (room.chat.length > 50) room.chat.shift();
      io.to(roomId).emit("chat_message", joinMsg);

      callback({ success: true, roomId, roomState: room });
      io.to(roomId).emit("room_updated", room);
    });

    socket.on("select_slot", ({ roomId, team, role }) => {
      const room = rooms[roomId];
      if (room && room.status === 'lobby') {
        const player = room.players.find(p => p.id === socket.id);
        const isTaken = room.players.some(p => p.team === team && p.role === role);
        if (player && !isTaken) {
          player.team = team; player.role = role;
          io.to(roomId).emit("room_updated", room);
        }
      }
    });

    socket.on("start_game", ({ roomId }) => {
      const room = rooms[roomId];
      if (room && room.players[0]?.id === socket.id) {
        room.status = 'playing';
        io.to(roomId).emit("room_updated", room);
      }
    });

    socket.on("send_chat", ({ roomId, text }) => {
      const room = rooms[roomId];
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          const msg = { sender: player.name, text, team: player.team };
          room.chat.push(msg);
          if (room.chat.length > 50) room.chat.shift();
          io.to(roomId).emit("chat_message", msg);
        }
      }
    });

    socket.on("sync_ball", ({ roomId, position, velocity }) => {
      socket.to(roomId).emit("ball_sync", { position, velocity });
    });

    socket.on("sync_rod", ({ roomId, rodIndex, zPos, angle }) => {
      socket.to(roomId).emit("rod_sync", { rodIndex, zPos, angle });
    });

    socket.on("score", ({ roomId, player }) => {
      const room = rooms[roomId];
      if (room && room.status === 'playing') {
        player === 1 ? room.score1++ : room.score2++;
        io.to(roomId).emit("score_update", { score1: room.score1, score2: room.score2 });
        if (room.score1 >= 7 || room.score2 >= 7) {
          room.status = 'gameover';
          io.to(roomId).emit("game_over", { winner: room.score1 >= 7 ? 1 : 2, score1: room.score1, score2: room.score2 });
        } else {
          io.to(roomId).emit("trigger_reset");
          room.resetVotes.clear();
          io.to(roomId).emit("reset_votes", 0);
        }
      }
    });

    socket.on("vote_reset", ({ roomId }) => {
      const room = rooms[roomId];
      if (room) {
        room.resetVotes.add(socket.id);
        io.to(roomId).emit("reset_votes", room.resetVotes.size);
        if (room.resetVotes.size >= Math.min(2, room.players.length)) {
          io.to(roomId).emit("trigger_reset");
          room.resetVotes.clear();
          io.to(roomId).emit("reset_votes", 0);
        }
      }
    });

    socket.on("play_again", ({ roomId }) => {
      const room = rooms[roomId];
      if (room && room.status === 'gameover') {
        room.status = 'playing'; room.score1 = 0; room.score2 = 0;
        io.to(roomId).emit("room_updated", room);
        io.to(roomId).emit("score_update", { score1: 0, score2: 0 });
        io.to(roomId).emit("trigger_reset");
      }
    });

    const handlePlayerLeave = (socketId: string) => {
      for (const roomId in rooms) {
        const room = rooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
          const player = room.players[playerIndex];
          
          // Mensagem de sistema que o jogador saiu
          const leaveMsg = { sender: 'System', text: `${player.name} abandonou a partida.`, system: true };
          room.chat.push(leaveMsg);
          if (room.chat.length > 50) room.chat.shift();
          io.to(roomId).emit("chat_message", leaveMsg);

          room.players.splice(playerIndex, 1);
          room.resetVotes.delete(socketId);
          if (room.players.length === 0) {
            delete rooms[roomId];
          } else {
            if (room.status === 'playing' || room.status === 'gameover') {
              room.score1 = 0; room.score2 = 0; room.status = 'lobby';
              io.to(roomId).emit("score_update", { score1: 0, score2: 0 });
              io.to(roomId).emit("trigger_reset");
            }
            io.to(roomId).emit("room_updated", room);
            io.to(roomId).emit("reset_votes", room.resetVotes.size);
          }
        }
      }
    };

    socket.on("leave_room", () => handlePlayerLeave(socket.id));
    socket.on("disconnect", () => handlePlayerLeave(socket.id));
  });

  const PORT = parseInt(process.env.PORT || '3000', 10); 
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer();