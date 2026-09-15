const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {

    console.log("プレイヤーが接続しました");

    // =========================
    // 部屋に参加
    // =========================
    socket.on("joinRoom", (roomId) => {

        // 部屋がなければ作成
        if (!rooms[roomId]) {
            rooms[roomId] = {
                host: socket.id,
                guest: null,
                choices: {}
            };

            socket.join(roomId);

            // 最初に入った人はホスト
            socket.emit("role", "host");

            io.to(roomId).emit("playerCount", 1);

            console.log(`${roomId}: ホストが参加`);
            return;
        }


        const room = rooms[roomId];

        // 同じ接続がもう参加している場合
        if (
            room.host === socket.id ||
            room.guest === socket.id
        ) {
            return;
        }


        // ゲスト枠が空いている
        if (!room.guest) {

            room.guest = socket.id;

            socket.join(roomId);

            socket.emit("role", "guest");

            io.to(roomId).emit("playerCount", 2);

            console.log(`${roomId}: ゲストが参加`);
            return;
        }


        // すでに2人いる
        socket.emit("roomFull");
    });


    // =========================
    // 手を選択
    // =========================
    socket.on("choose", ({ roomId, choice }) => {

        const room = rooms[roomId];

        if (!room) return;

        // 不正な選択を防止
        const validChoices = [
            "demon",
            "human",
            "angel"
        ];

        if (!validChoices.includes(choice)) {
            return;
        }


        // この部屋のプレイヤーか確認
        if (
            socket.id !== room.host &&
            socket.id !== room.guest
        ) {
            return;
        }


        // 選択を保存
        room.choices[socket.id] = choice;


        // =========================
        // ゲストが選んだ場合
        // ホストだけに内容を通知
        // =========================
        if (socket.id === room.guest) {

            io.to(room.host).emit(
                "guestChoice",
                choice
            );

            socket.emit("choiceAccepted");
        }


        // =========================
        // ホストが選んだ場合
        // =========================
        if (socket.id === room.host) {

            socket.emit("choiceAccepted");
        }


        // =========================
        // 2人とも選んだら結果発表
        // =========================
        if (
            room.choices[room.host] &&
            room.choices[room.guest]
        ) {

            const hostChoice =
                room.choices[room.host];

            const guestChoice =
                room.choices[room.guest];


            io.to(room.host).emit("result", {
                you: hostChoice,
                opponent: guestChoice
            });


            io.to(room.guest).emit("result", {
                you: guestChoice,
                opponent: hostChoice
            });


            // 次の勝負用にリセット
            room.choices = {};
        }

    });


    // =========================
    // 切断
    // =========================
    socket.on("disconnect", () => {

        for (const roomId in rooms) {

            const room = rooms[roomId];


            // ホストが退出した
            if (room.host === socket.id) {

                if (room.guest) {

                    io.to(room.guest).emit(
                        "hostDisconnected"
                    );

                }

                delete rooms[roomId];

                console.log(
                    `${roomId}: 部屋を削除`
                );

                continue;
            }


            // ゲストが退出した
            if (room.guest === socket.id) {

                room.guest = null;
                room.choices = {};

                io.to(room.host).emit(
                    "guestDisconnected"
                );

                io.to(room.host).emit(
                    "playerCount",
                    1
                );

                console.log(
                    `${roomId}: ゲスト退出`
                );
            }

        }

    });

});


const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log("じゃんけんサーバー起動！");
    console.log(`http://localhost:${PORT}`);

});