// Cloudflare Worker starter. Add only permitted official feeds/APIs.
// Do not rewrite headlines or insert fake news.
export default {async fetch(request, env){return Response.json({status:"ok",items:[]},{headers:{"Access-Control-Allow-Origin":"*"}})},async scheduled(event,env,ctx){/* Connect permitted sources here later. */}};