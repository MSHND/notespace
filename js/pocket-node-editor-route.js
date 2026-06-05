/* Tiny native PE route. Title source: node.label. Body source: node.pe. */
(function(g){"use strict";
const SCHEMA="pocket.pe.v1",MAX_TEXT=120000,MAX_LINES=3000,MAX_LINE=1200;
function c(v,n=80){return typeof cleanText==="function"?cleanText(v,n):String(v||"").trim().slice(0,n)}
function ns(){return Array.isArray(g.state&&g.state.nodes)?g.state.nodes:[]}
function by(id){return ns().find(n=>n&&n.id===id)||null}
function lid(){return"line_"+Math.random().toString(36).slice(2,9)}
function ol(a