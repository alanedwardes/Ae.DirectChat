export function shortId(id: string): string {
	return id ? id.substring(0, 6) : "------";
}

export function formatTraffic(direction: "in" | "out", data: any): string {
	const type = data.Type ?? data.type;
	const fromId = data.FromId ?? data.fromId;
	const toId = data.ToId ?? data.toId;
	const payload = data.Data ?? data.data;
	const arrow = direction === "in" ? "<-" : "->";
	const peer = shortId(direction === "in" ? fromId : toId);

	if (type === "location") {
		const city = payload && payload.cityName;
		const cc = payload && payload.countryCode;
		const loc = city ? city + " " + cc : (cc ?? "");
		return "[ws " + direction + "] location " + arrow + " " + peer + (loc ? " " + loc : "");
	}

	if (type === "discover" || type === "acknowledge") {
		return "[ws " + direction + "] " + type + " " + arrow + " " + peer;
	}

	if (type === "offer" || type === "answer" || type === "pranswer") {
		const sdpLen = typeof (payload && payload.sdp) === "string" ? payload.sdp.length : 0;
		return "[ws " + direction + "] " + type + " " + arrow + " " + peer + " (sdp " + sdpLen + ")";
	}

	if (type === "candidate") {
		return "[ws " + direction + "] ice " + arrow + " " + peer;
	}

	const size = typeof payload === "string" ? payload.length : (payload ? Object.keys(payload).length : 0);
	return "[ws " + direction + "] " + (type ?? "?") + " " + arrow + " " + peer + " (" + size + ")";
}

