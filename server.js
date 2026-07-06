import express from "express";
import cors from "cors";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Có thể đổi key trong Render Environment nếu muốn.
// Nhưng key trong Roblox phải giống hệt key ở đây.
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "longmc_bridge_1102153229";

let eventQueue = [];
let eventId = 1;

let tiktokConnection = null;
let tiktokStatus = {
	connected: false,
	connecting: false,
	username: null,
	roomId: null,
	lastError: null
};

function hasValidKey(req) {
	const keyFromQuery = req.query.key;
	const keyFromHeader = req.headers["x-bridge-key"];

	return keyFromQuery === BRIDGE_SECRET || keyFromHeader === BRIDGE_SECRET;
}

function requireSecret(req, res, next) {
	if (!hasValidKey(req)) {
		return res.status(401).json({
			ok: false,
			error: "Invalid or missing secret key"
		});
	}

	next();
}

function createEvent(type, data) {
	const event = {
		id: String(eventId++),
		type,
		createdAt: Date.now(),
		...data
	};

	eventQueue.push(event);

	if (eventQueue.length > 200) {
		eventQueue.shift();
	}

	console.log("New event:", event);

	return event;
}

function getUserName(data) {
	return (
		data?.user?.uniqueId ||
		data?.user?.nickname ||
		data?.uniqueId ||
		data?.nickname ||
		"UnknownUser"
	);
}

function getNickName(data) {
	return data?.user?.nickname || data?.nickname || getUserName(data);
}

function normalizeTikTokUsername(username) {
	return String(username || "")
		.replace("@", "")
		.trim();
}

function mapGiftCoinValue(data) {
	const repeatCount = Number(data?.repeatCount || 1);

	const baseCoinValue =
		Number(data?.giftDetails?.diamondCount) ||
		Number(data?.diamondCount) ||
		Number(data?.gift?.diamondCount) ||
		Number(data?.giftDetails?.giftValue) ||
		Number(data?.giftValue) ||
		1;

	return Math.max(1, baseCoinValue * repeatCount);
}

async function disconnectTikTok() {
	if (tiktokConnection) {
		try {
			await tiktokConnection.disconnect();
		} catch (error) {
			console.log("Disconnect warning:", error?.message || error);
		}
	}

	tiktokConnection = null;

	tiktokStatus.connected = false;
	tiktokStatus.connecting = false;
	tiktokStatus.roomId = null;
}

async function connectTikTok(username) {
	username = normalizeTikTokUsername(username);

	if (!username) {
		throw new Error("Missing TikTok username");
	}

	await disconnectTikTok();

	tiktokStatus = {
		connected: false,
		connecting: true,
		username,
		roomId: null,
		lastError: null
	};

	const connection = new TikTokLiveConnection(username);
	tiktokConnection = connection;

	connection.on(WebcastEvent.CHAT, (data) => {
		const username = getUserName(data);
		const comment = String(data?.comment || "");

		createEvent("comment", {
			username,
			nickname: getNickName(data),
			comment
		});
	});

	connection.on(WebcastEvent.FOLLOW, (data) => {
		const username = getUserName(data);

		createEvent("follow", {
			username,
			nickname: getNickName(data),
			robloxUsername: username
		});
	});

	connection.on(WebcastEvent.GIFT, (data) => {
		const giftType = data?.giftDetails?.giftType;
		const repeatEnd = data?.repeatEnd;

		if (giftType === 1 && !repeatEnd) {
			console.log("Gift streak still running, waiting for repeatEnd...");
			return;
		}

		const username = getUserName(data);

		const giftName =
			data?.giftDetails?.giftName ||
			data?.giftName ||
			String(data?.giftId || "Gift");

		const coinValue = mapGiftCoinValue(data);

		createEvent("gift", {
			username,
			nickname: getNickName(data),
			robloxUsername: username,
			giftName,
			coinValue
		});
	});

	connection.on(WebcastEvent.STREAM_END, () => {
		console.log("TikTok live stream ended.");

		tiktokStatus.connected = false;
		tiktokStatus.connecting = false;

		createEvent("comment", {
			username: "SYSTEM",
			comment: "TikTok live ended"
		});
	});

	const state = await connection.connect();

	tiktokStatus.connected = true;
	tiktokStatus.connecting = false;
	tiktokStatus.roomId = state?.roomId || null;

	console.log(`Connected to TikTok LIVE @${username}`, state);

	return state;
}

app.get("/", (req, res) => {
	res.json({
		ok: true,
		message: "TikTok Roblox Bridge is running",
		secured: true,
		queuedEvents: eventQueue.length,
		tiktok: tiktokStatus
	});
});

app.get("/status", (req, res) => {
	res.json({
		ok: true,
		secured: true,
		queuedEvents: eventQueue.length,
		tiktok: tiktokStatus
	});
});

app.get("/connect/:username", requireSecret, async (req, res) => {
	try {
		const username = req.params.username;
		const state = await connectTikTok(username);

		res.json({
			ok: true,
			message: "Connected to TikTok LIVE",
			username,
			roomId: state?.roomId || null
		});
	} catch (error) {
		tiktokStatus.connected = false;
		tiktokStatus.connecting = false;
		tiktokStatus.lastError = error?.message || String(error);

		console.error("TikTok connect failed:", error);

		res.status(500).json({
			ok: false,
			error: tiktokStatus.lastError
		});
	}
});

app.get("/disconnect", requireSecret, async (req, res) => {
	await disconnectTikTok();

	res.json({
		ok: true,
		message: "Disconnected from TikTok LIVE"
	});
});

app.get("/events", requireSecret, (req, res) => {
	const events = eventQueue.splice(0, 20);

	res.json({
		ok: true,
		events
	});
});

app.post("/push", requireSecret, (req, res) => {
	const body = req.body || {};

	if (!body.type) {
		return res.status(400).json({
			ok: false,
			error: "Missing event type"
		});
	}

	const event = createEvent(body.type, {
		username: body.username || "TestUser",
		robloxUsername: body.robloxUsername,
		comment: body.comment,
		coinValue: body.coinValue,
		giftName: body.giftName
	});

	res.json({
		ok: true,
		event
	});
});

app.get("/fake/comment", requireSecret, (req, res) => {
	const username = req.query.username || "CommentUser";
	const comment = req.query.comment || "Builderman";

	const event = createEvent("comment", {
		username,
		comment
	});

	res.json({
		ok: true,
		event
	});
});

app.get("/fake/follow", requireSecret, (req, res) => {
	const username = req.query.username || "FollowUser";
	const robloxUsername = req.query.robloxUsername || username;

	const event = createEvent("follow", {
		username,
		robloxUsername
	});

	res.json({
		ok: true,
		event
	});
});

app.get("/fake/gift", requireSecret, (req, res) => {
	const username = req.query.username || "GiftUser";
	const robloxUsername = req.query.robloxUsername || username;
	const coinValue = Number(req.query.coinValue || 1);

	const event = createEvent("gift", {
		username,
		robloxUsername,
		coinValue
	});

	res.json({
		ok: true,
		event
	});
});

app.listen(PORT, () => {
	console.log(`TikTok Roblox Bridge running on port ${PORT}`);
});
