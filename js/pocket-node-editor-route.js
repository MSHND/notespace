/* Micro PE route repair: title=node.label; details=node.pe. */
(function(g){
"use strict";
var S="pocket.pe.v1";
function z(v,m){return String(v==null?"":v).replace(/\r/g,"").slice(0,m||120000)}
function list(){return g.state&&Array.isArray(g.state.nodes)?g.state.nodes:g.state&&Array.isArray(g.state.mainThoughtTree)?g.state.mainThoughtTree:[]}
function node(id){if(!id)return null;if(typeof nodeMap==="function")return nodeMap().get(id)||null;return list().find(function(x){return x&&x.id===id})||null}
function sid