const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const HOST_PASSWORD = process.env.HOST_PASSWORD;


/* ========================================
   部屋コード作成
======================================== */

function makeRoomId() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let id = "";

    do {

        id = "";

        for (let i = 0; i < 6; i++) {

            id += chars[
                Math.floor(
                    Math.random() * chars.length
                )
            ];
        }

    } while (rooms[id]);

    return id;
}


/* ========================================
   選択肢チェック
======================================== */

function validChoice(choice) {

    return [
        "demon",
        "human",
        "angel"
    ].includes(choice);
}


/* ========================================
   ラウンドリセット

   ※ゲスト画像のA/B設定は
     ここではリセットしない
======================================== */

function resetRound(room) {

    room.guestChoice = null;
    room.hostChoice = null;

    room.hostReady = false;
    room.guestReady = false;

    room.charmed = false;

    room.state =
        "waitingGuestChoice";
}


/* ========================================
   ラウンド開始
======================================== */

function startRound(roomId) {

    const room = rooms[roomId];

    if (
        !room ||
        !room.host ||
        !room.guest
    ) {
        return;
    }

    resetRound(room);

    io.to(room.host).emit(
        "roundStart",
        {
            role: "host",
            charmed: false,

            guestImages:
                room.guestImages
        }
    );

    io.to(room.guest).emit(
        "roundStart",
        {
            role: "guest",
            charmed: false,

            guestImages:
                room.guestImages
        }
    );

    console.log(
        `${roomId}: ラウンド開始`
    );
}


/* ========================================
   Socket.IO
======================================== */

io.on("connection", socket => {

    console.log(
        "接続:",
        socket.id
    );


    /* ====================================
       部屋作成
    ==================================== */

    socket.on(
        "createRoom",
        password => {

            if (!HOST_PASSWORD) {

                socket.emit(
                    "createRoomError",
                    "サーバーにホスト用パスワードが設定されていません。"
                );

                return;
            }

            if (
                password !==
                HOST_PASSWORD
            ) {

                socket.emit(
                    "createRoomError",
                    "パスワードが違います。"
                );

                return;
            }

            const roomId =
                makeRoomId();

            rooms[roomId] = {

                host: socket.id,

                guest: null,

                guestChoice: null,
                hostChoice: null,

                hostReady: false,
                guestReady: false,

                charmed: false,

                /*
                    ゲスト側カードの
                    A/B状態

                    false = A
                    true  = B
                */

                guestImages: {

                    demon: false,
                    human: false,
                    angel: false
                },

                state:
                    "waitingGuest"
            };

            socket.join(roomId);

            socket.data.roomId =
                roomId;

            socket.data.role =
                "host";

            socket.emit(
                "roomCreated",
                {
                    roomId,

                    guestImages:
                        rooms[roomId]
                            .guestImages
                }
            );

            console.log(
                `${roomId}: 部屋作成`
            );
        }
    );


    /* ====================================
       ゲスト参加
    ==================================== */

    socket.on(
        "joinRoom",
        roomId => {

            roomId =
                String(roomId || "")
                    .trim()
                    .toUpperCase();

            const room =
                rooms[roomId];

            if (!room) {

                socket.emit(
                    "joinRoomError",
                    "その部屋は存在しません。"
                );

                return;
            }

            if (room.guest) {

                socket.emit(
                    "joinRoomError",
                    "この部屋はすでに満員です。"
                );

                return;
            }

            room.guest =
                socket.id;

            socket.join(roomId);

            socket.data.roomId =
                roomId;

            socket.data.role =
                "guest";

            socket.emit(
                "roomJoined",
                {
                    roomId,

                    guestImages:
                        room.guestImages
                }
            );

            io.to(room.host).emit(
                "guestJoined"
            );

            console.log(
                `${roomId}: ゲスト参加`
            );

            startRound(roomId);
        }
    );


    /* ====================================
       ★ ゲスト画像 A/B切り替え
    ==================================== */

    socket.on(
        "toggleGuestImage",
        choice => {

            const roomId =
                socket.data.roomId;

            const role =
                socket.data.role;

            if (
                !roomId ||
                role !== "host"
            ) {
                return;
            }

            if (
                !validChoice(choice)
            ) {
                return;
            }

            const room =
                rooms[roomId];

            if (!room) {
                return;
            }

            /*
                A → B
                B → A
            */

            room.guestImages[choice] =
                !room.guestImages[choice];

            const isB =
                room.guestImages[choice];

            /*
                ホストとゲスト両方に
                現在状態を通知
            */

            io.to(roomId).emit(
                "guestImageChanged",
                {
                    choice,
                    isB,
                    guestImages:
                        room.guestImages
                }
            );

            console.log(
                `${roomId}: ゲスト ${choice} 画像 → ${isB ? "B" : "A"}`
            );
        }
    );


    /* ====================================
       魅了
    ==================================== */

    socket.on(
        "useCharm",
        () => {

            console.log(
                "useCharmを受信:",
                socket.id
            );

            const roomId =
                socket.data.roomId;

            const role =
                socket.data.role;

            if (!roomId) {

                console.log(
                    "魅了失敗: roomIdなし"
                );

                return;
            }

            if (
                role !== "host"
            ) {

                console.log(
                    `${roomId}: 魅了失敗 - ホストではありません`
                );

                return;
            }

            const room =
                rooms[roomId];

            if (!room) {

                console.log(
                    `${roomId}: 魅了失敗 - 部屋なし`
                );

                return;
            }

            if (!room.guest) {

                socket.emit(
                    "charmError",
                    "ゲストがまだ参加していません。"
                );

                return;
            }

            if (
                room.state !==
                "waitingGuestChoice"
            ) {

                socket.emit(
                    "charmError",
                    "魅了はゲストが選択する前だけ使用できます。"
                );

                return;
            }

            if (room.charmed) {

                socket.emit(
                    "charmError",
                    "すでに魅了を使用しています。"
                );

                return;
            }

            room.charmed = true;

            console.log(
                `${roomId}: ホストが魅了を使用`
            );

            io.to(room.host).emit(
                "charmActivated",
                {
                    role: "host"
                }
            );

            io.to(room.guest).emit(
                "charmActivated",
                {
                    role: "guest"
                }
            );
        }
    );


    /* ====================================
       選択
    ==================================== */

    socket.on(
        "choose",
        choice => {

            const roomId =
                socket.data.roomId;

            const role =
                socket.data.role;

            if (
                !roomId ||
                !role
            ) {
                return;
            }

            const room =
                rooms[roomId];

            if (
                !room ||
                !validChoice(choice)
            ) {
                return;
            }


            /* ============================
               ゲスト
            ============================ */

            if (
                role === "guest"
            ) {

                if (
                    room.state !==
                    "waitingGuestChoice"
                ) {
                    return;
                }

                if (
                    room.charmed &&
                    choice === "demon"
                ) {

                    socket.emit(
                        "choiceRejected",
                        "💗 魅了されているため、魔族は選択できません。"
                    );

                    return;
                }

                room.guestChoice =
                    choice;

                room.state =
                    "waitingHostChoice";

                socket.emit(
                    "choiceAccepted",
                    {
                        choice
                    }
                );

                io.to(room.host).emit(
                    "guestChoice",
                    choice
                );

                console.log(
                    `${roomId}: ゲストが ${choice} を選択`
                );

                return;
            }


            /* ============================
               ホスト
            ============================ */

            if (
                role === "host"
            ) {

                if (
                    room.state !==
                    "waitingHostChoice"
                ) {
                    return;
                }

                if (
                    !room.guestChoice
                ) {
                    return;
                }

                room.hostChoice =
                    choice;

                room.state =
                    "result";

                socket.emit(
                    "choiceAccepted",
                    {
                        choice
                    }
                );

                console.log(
                    `${roomId}: ホストが ${choice} を選択`
                );


                /*
                    結果送信

                    guestImagesも一緒に送る
                */

                io.to(room.host).emit(
                    "result",
                    {
                        you:
                            room.hostChoice,

                        opponent:
                            room.guestChoice,

                        charmed:
                            room.charmed,

                        guestImages:
                            room.guestImages
                    }
                );

                io.to(room.guest).emit(
                    "result",
                    {
                        you:
                            room.guestChoice,

                        opponent:
                            room.hostChoice,

                        charmed:
                            room.charmed,

                        guestImages:
                            room.guestImages
                    }
                );
            }
        }
    );


    /* ====================================
       再戦
    ==================================== */

    socket.on(
        "rematchReady",
        () => {

            const roomId =
                socket.data.roomId;

            const role =
                socket.data.role;

            if (
                !roomId ||
                !role
            ) {
                return;
            }

            const room =
                rooms[roomId];

            if (
                !room ||
                room.state !==
                    "result"
            ) {
                return;
            }

            if (
                role === "host"
            ) {

                room.hostReady =
                    true;
            }

            if (
                role === "guest"
            ) {

                room.guestReady =
                    true;
            }

            io.to(roomId).emit(
                "rematchStatus",
                {
                    hostReady:
                        room.hostReady,

                    guestReady:
                        room.guestReady
                }
            );

            if (
                room.hostReady &&
                room.guestReady
            ) {

                setTimeout(
                    () =>
                        startRound(
                            roomId
                        ),
                    500
                );
            }
        }
    );


    /* ====================================
       切断
    ==================================== */

    socket.on(
        "disconnect",
        () => {

            const roomId =
                socket.data.roomId;

            const role =
                socket.data.role;

            if (
                !roomId ||
                !role
            ) {
                return;
            }

            const room =
                rooms[roomId];

            if (!room) {
                return;
            }


            /* ホスト退出 */

            if (
                role === "host"
            ) {

                if (room.guest) {

                    io.to(room.guest).emit(
                        "roomClosed",
                        "ホストが退出したため、部屋が終了しました。"
                    );
                }

                delete rooms[roomId];

                console.log(
                    `${roomId}: 部屋削除`
                );

                return;
            }


            /* ゲスト退出 */

            if (
                role === "guest"
            ) {

                room.guest = null;

                room.guestChoice =
                    null;

                room.hostChoice =
                    null;

                room.hostReady =
                    false;

                room.guestReady =
                    false;

                room.charmed =
                    false;

                room.state =
                    "waitingGuest";

                io.to(room.host).emit(
                    "guestLeft"
                );

                console.log(
                    `${roomId}: ゲスト退出`
                );
            }
        }
    );
});


/* ========================================
   サーバー起動
======================================== */

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    () => {

        console.log(
            "三界じゃんけん サーバー起動！"
        );

        console.log(
            `http://localhost:${PORT}`
        );

        if (!HOST_PASSWORD) {

            console.log(
                "注意: HOST_PASSWORD が設定されていません。"
            );

        } else {

            console.log(
                "ホスト用パスワード: 設定済み"
            );
        }
    }
);