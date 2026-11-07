const res = await fetch("http://127.0.0.1:8082/api/local/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ fn: "get_display_board", args: {} }),
});
const json = await res.json();
console.log("status", res.status);
console.log("error", json.error);
console.log("waiting_all", json.data?.waiting_all);
console.log(
  "queues",
  json.data?.queues?.filter((q) => q.waiting > 0)?.map((q) => ({ code: q.code, n: q.waiting })),
);
