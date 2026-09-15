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
   部屋コード生成
======================================== */

function makeRoomId() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let id = "";

    do {

        id = "";

        for (let i = 0; i < 6; i++) {

            id +=
                chars[
                    Math.floor(
                        Math.random() *
                        chars.length
                    )
                ];
        }

    } while (rooms[id]);

    return id;
}


/* ========================================
   カード確認
======================================== */

function validChoice(choice) {

    return [
        "demon",
        "human",
        "angel"
    ].includes(choice);
}


/* ========================================
   勝敗判定
   host / guest のどちらが勝ったか返す
======================================== */

function getWinner(
    hostChoice,
    guestChoice
) {

    if (
        hostChoice === guestChoice
    ) {
        return "draw";
    }


    const hostWins =

        (
            hostChoice === "demon" &&
            guestChoice === "human"
        )

        ||

        (
            hostChoice === "human" &&
            guestChoice === "angel"
        )

        ||

        (
            hostChoice === "angel" &&
            guestChoice === "demon"
        );


    return hostWins
        ? "host"
        : "guest";
}


/* ========================================
   ラウンド初期化
======================================== */

function resetRound(room) {

    room.guestChoice = null;

    room.hostChoice = null;

    room.hostReady = false;

    room.guestReady = false;

    room.charmed = false;

    /*
        ★重要
        ホストが許可するまで
        ゲストは選択できない
    */
    room.guestCanChoose = false;

    room.state =
        "hostPreparing";

    /*
        guestImages と guestMoney は
        再戦してもリセットしない
    */
}


/* ========================================
   ラウンド開始
======================================== */

function startRound(roomId) {

    const room =
        rooms[roomId];

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
            guestCanChoose: false,
            guestImages:
                room.guestImages,
            guestMoney:
                room.guestMoney
        }
    );


    io.to(room.guest).emit(
        "roundStart",
        {
            role: "guest",
            charmed: false,
            guestCanChoose: false,
            guestImages:
                room.guestImages,
            guestMoney:
                room.guestMoney
        }
    );


    console.log(
        `${roomId}: ラウンド開始`
    );
}


/* ========================================
   Socket.IO
======================================== */

io.on(
    "connection",
    socket => {


        console.log(
            "接続:",
            socket.id
        );


        /* =================================
           部屋作成
        ================================= */

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

                    host:
                        socket.id,

                    guest:
                        null,

                    guestChoice:
                        null,

                    hostChoice:
                        null,

                    hostReady:
                        false,

                    guestReady:
                        false,

                    charmed:
                        false,

                    guestCanChoose:
                        false,

                    /*
                        ★ゲスト通算金額
                    */
                    guestMoney:
                        0,

                    guestImages: {

                        demon:
                            false,

                        human:
                            false,

                        angel:
                            false
                    },

                    state:
                        "waitingGuest"
                };


                socket.join(
                    roomId
                );


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
                                .guestImages,

                        guestMoney:
                            rooms[roomId]
                                .guestMoney
                    }
                );


                console.log(
                    `${roomId}: 部屋作成`
                );
            }
        );


        /* =================================
           部屋参加
        ================================= */

        socket.on(
            "joinRoom",
            roomId => {


                roomId =
                    String(
                        roomId || ""
                    )
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


                /*
                    ★新しいゲストなので
                    通算金額を0円にする
                */
                room.guestMoney =
                    0;


                socket.join(
                    roomId
                );


                socket.data.roomId =
                    roomId;


                socket.data.role =
                    "guest";


                socket.emit(
                    "roomJoined",
                    {

                        roomId,

                        guestImages:
                            room.guestImages,

                        guestMoney:
                            room.guestMoney
                    }
                );


                io.to(
                    room.host
                ).emit(
                    "guestJoined"
                );


                console.log(
                    `${roomId}: ゲスト参加`
                );


                startRound(
                    roomId
                );
            }
        );


        /* =================================
           ゲスト画像 A/B変更
        ================================= */

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
                    ★選択許可後は変更禁止
                */
                if (
                    room.state !==
                    "hostPreparing"
                ) {

                    socket.emit(
                        "guestImageChangeError",
                        "選択を許可した後はカード画像を変更できません。"
                    );

                    return;
                }


                room.guestImages[choice] =
                    !room.guestImages[choice];


                const isB =
                    room.guestImages[choice];


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


        /* =================================
           魅了
        ================================= */

        socket.on(
            "useCharm",
            () => {


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


                const room =
                    rooms[roomId];


                if (!room) {
                    return;
                }


                if (!room.guest) {

                    socket.emit(
                        "charmError",
                        "ゲストがまだ参加していません。"
                    );

                    return;
                }


                /*
                    ★ホスト準備中のみ使用可能
                */
                if (
                    room.state !==
                    "hostPreparing"
                ) {

                    socket.emit(
                        "charmError",
                        "ゲストの選択を許可した後は魅了できません。"
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


                room.charmed =
                    true;


                console.log(
                    `${roomId}: ホストが魅了を使用`
                );


                io.to(
                    room.host
                ).emit(
                    "charmActivated",
                    {
                        role: "host"
                    }
                );


                io.to(
                    room.guest
                ).emit(
                    "charmActivated",
                    {
                        role: "guest"
                    }
                );
            }
        );


        /* =================================
           ★ゲスト選択許可
        ================================= */

        socket.on(
            "allowGuestChoice",
            () => {


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


                const room =
                    rooms[roomId];


                if (
                    !room ||
                    !room.guest
                ) {
                    return;
                }


                if (
                    room.state !==
                    "hostPreparing"
                ) {
                    return;
                }


                room.guestCanChoose =
                    true;


                room.state =
                    "waitingGuestChoice";


                io.to(
                    room.host
                ).emit(
                    "guestChoiceAllowed",
                    {
                        role: "host"
                    }
                );


                io.to(
                    room.guest
                ).emit(
                    "guestChoiceAllowed",
                    {
                        role: "guest",
                        charmed:
                            room.charmed
                    }
                );


                console.log(
                    `${roomId}: ゲストの選択を許可`
                );
            }
        );


        /* =================================
           カード選択
        ================================= */

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


                /* =========================
                   ゲスト
                ========================= */

                if (
                    role === "guest"
                ) {


                    /*
                        ★サーバー側でも
                        許可前の選択を禁止
                    */
                    if (
                        !room.guestCanChoose ||
                        room.state !==
                            "waitingGuestChoice"
                    ) {

                        socket.emit(
                            "choiceRejected",
                            "ホストがまだ選択を許可していません。"
                        );

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


                    room.guestCanChoose =
                        false;


                    room.state =
                        "waitingHostChoice";


                    socket.emit(
                        "choiceAccepted",
                        {
                            choice
                        }
                    );


                    /*
                        ★ホストだけに
                        ゲストの選択を公開
                    */
                    io.to(
                        room.host
                    ).emit(
                        "guestChoice",
                        choice
                    );


                    console.log(
                        `${roomId}: ゲストが ${choice} を選択`
                    );


                    return;
                }


                /* =========================
                   ホスト
                ========================= */

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


                    const winner =
                        getWinner(
                            room.hostChoice,
                            room.guestChoice
                        );


                    /*
                        ★通算金額更新

                        ゲスト勝利
                        +500円

                        ゲスト敗北
                        -1000円

                        DRAW
                        0円
                    */

                    let moneyChange =
                        0;


                    if (
                        winner === "guest"
                    ) {

                        moneyChange =
                            500;
                    }


                    if (
                        winner === "host"
                    ) {

                        moneyChange =
                            -1000;
                    }


                    room.guestMoney +=
                        moneyChange;


                    console.log(
                        `${roomId}: 勝者 ${winner} / 金額変動 ${moneyChange} / 通算 ${room.guestMoney}`
                    );


                    io.to(
                        room.host
                    ).emit(
                        "result",
                        {

                            you:
                                room.hostChoice,

                            opponent:
                                room.guestChoice,

                            charmed:
                                room.charmed,

                            guestImages:
                                room.guestImages,

                            guestMoney:
                                room.guestMoney,

                            moneyChange
                        }
                    );


                    io.to(
                        room.guest
                    ).emit(
                        "result",
                        {

                            you:
                                room.guestChoice,

                            opponent:
                                room.hostChoice,

                            charmed:
                                room.charmed,

                            guestImages:
                                room.guestImages,

                            guestMoney:
                                room.guestMoney,

                            moneyChange
                        }
                    );
                }
            }
        );


        /* =================================
           再戦準備
        ================================= */

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
                        () => {

                            startRound(
                                roomId
                            );

                        },
                        500
                    );
                }
            }
        );


        /* =================================
           切断
        ================================= */

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


                /* =========================
                   ホスト退出
                ========================= */

                if (
                    role === "host"
                ) {


                    if (room.guest) {

                        io.to(
                            room.guest
                        ).emit(
                            "roomClosed",
                            "ホストが退出したため、部屋が終了しました。"
                        );
                    }


                    delete rooms[
                        roomId
                    ];


                    console.log(
                        `${roomId}: 部屋削除`
                    );


                    return;
                }


                /* =========================
                   ゲスト退出
                ========================= */

                if (
                    role === "guest"
                ) {


                    room.guest =
                        null;


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


                    room.guestCanChoose =
                        false;


                    /*
                        ★新しいゲスト用に
                        金額リセット
                    */
                    room.guestMoney =
                        0;


                    room.state =
                        "waitingGuest";


                    io.to(
                        room.host
                    ).emit(
                        "guestLeft"
                    );


                    console.log(
                        `${roomId}: ゲスト退出`
                    );
                }
            }
        );
    }
);


/* ========================================
   サーバー起動
======================================== */

const PORT =
    process.env.PORT ||
    3000;


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