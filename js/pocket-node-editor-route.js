/* Tiny native PE route repair: title=node.label; details=node.pe. */
(function(g){
"use strict";
var SCHEMA="pocket.pe.v1";
function s(v,m){return String(v==null?"":v).replace(/\r/g,"").slice(0,m||120000)}
function ns(){return g.state&&Array.isArray(g.state.nodes)?g.state.nodes:g.state&&Array.isArray(g.state.mainThoughtTree)?g.state.mainThoughtTree:[]}
function n(id){if(!id)return null;if(typeof nodeMap==="function")return nodeMap().get(id)||null;return ns().find(function(x){return x&&x.id