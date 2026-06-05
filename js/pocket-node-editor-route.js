/* Minimal PE route repair: valid hooks only. */
(function(g){
"use strict";
function A(){return g.state&&Array.isArray(g.state.nodes)?g.state.nodes:[]}
function N(id){return A().find(function(x){return x&&x.id===id})||null}
function P(id){var n=N(id||(g.state&&g.state.selectedId));var p=n&&n.pe||{};return n?{nodeId:n.id,title:n.label||p.title||"",mode:p.mode||"text",text:p.text||"",outline:Array.isArray(p.outline)?p.outline:[]}:null}
function V