const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let eventQueue = [];
let eventId = 1;

function createEvent(type, data) {
	const event = {
		id: String(eventId++),
		type,
		createdAt: Date.now(),
		...data
	};

	eventQueue.push(event);

	if (eventQueue.length > 100) {
		eventQueue.shift();
	}

	console.log("New event:", event);

	return event;
}

app.get("/", (req, res) => {
	res.json({
		ok: true,
		message: "TikTok Roblox Bridge is running",
		queuedEvents: eventQueue.length
	});
});

app.get("/events", (req, res) => {
	const events = eventQueue.splice(0, 20);

	res.json({
		ok: true,
		events
	});
});

app.post("/push", (req, res) => {
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

app.get("/fake/comment", (req, res) => {
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

app.get("/fake/follow", (req, res) => {
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

app.get("/fake/gift", (req, res) => {
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