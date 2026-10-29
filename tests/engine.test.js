import test from 'node:test';import assert from 'node:assert/strict';import {roll,initiativeOrder} from '../dist/engine.js';
test('dice apply count and signed modifiers at both bounds',()=>{assert.deepEqual(roll('2d6+3',()=>0),{rolls:[1,1],total:5});assert.equal(roll('1d20-2',()=>.999999).total,18);assert.equal(roll('d100',()=>0).total,1)});
test('invalid and excessive rolls are rejected',()=>{for(const f of ['0d20','101d6','1d7','hello','1d20+alert(1)'])assert.throws(()=>roll(f))});
test('initiative is descending, breaks ties by modifier, preserves input',()=>{const t=[{name:'B',init:10,mod:1},{name:'A',init:10,mod:3},{name:'C',init:null,mod:0}];assert.deepEqual(initiativeOrder(t).map(t=>t.name),['A','B','C']);assert.equal(t[0].name,'B')});
