// Paper 1.21 uses three PotionContents fields. The installed minecraft-data schema
// also lists customName (a later protocol field), shifting every following slot.
// Keep this compatibility correction scoped to the pinned local 1.21 clients.
const mineflayer=require('../bot-controller/node_modules/mineflayer');
const minecraftData=require('../bot-controller/node_modules/minecraft-data');
function packetOverrides(version='1.21'){
 if(!['1.21','1.21.1'].includes(version))return undefined;
 const data=minecraftData(version),component=structuredClone(data.protocol.types.SlotComponent);
 const potion=component[1][1].type[1].fields.potion_contents[1];
 const laterField=potion.find(field=>field.name==='customName');
 // lodash.merge retains array entries, so a zero-byte field is used explicitly.
 if(laterField)laterField.type='void';
 return {[data.version.majorVersion]:{types:{SlotComponent:component}}};
}
function createBot(options){return mineflayer.createBot({...options,customPackets:packetOverrides(options.version)||options.customPackets});}
module.exports={createBot,packetOverrides};
