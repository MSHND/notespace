"use strict";
// Synthetic adapter ONLY: Node unit fixtures. It cannot witness PostgreSQL
// transactions, locks, row privileges, serialization or durability.
const {SQL}=require("../../sync-service/pocket-handover-release-safety-store.js");
function fakeTransactionalPool(query,{commitError=()=>false}={}) {
  return Object.freeze({
    query,
    async connect() {
      let active=false, ended=false;
      return Object.freeze({
        async query(sql,values=[]) {
          if(sql==="BEGIN ISOLATION LEVEL SERIALIZABLE") {
            if(active || ended) throw Error("bad synthetic BEGIN");
            active=true;return {rowCount:0,rows:[]};
          }
          if(sql==="ROLLBACK") {
            if(!active) throw Error("bad synthetic ROLLBACK");
            active=false;return {rowCount:0,rows:[]};
          }
          if(sql==="COMMIT") {
            if(!active) throw Error("bad synthetic COMMIT");
            active=false;
            if(commitError()) throw Error("synthetic lost COMMIT acknowledgement");
            return {rowCount:0,rows:[]};
          }
          if(!active) throw Error("synthetic SQL outside transaction");
          return query(sql===SQL.lockEntry?SQL.readEntry:sql,values);
        },
        release() {ended=true;},
      });
    },
  });
}
module.exports={fakeTransactionalPool};
