import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

const gameEl = document.querySelector('#game');
const startScreen = document.querySelector('#startScreen');
const deathScreen = document.querySelector('#deathScreen');
const startBtn = document.querySelector('#startBtn');
const restartBtn = document.querySelector('#restartBtn');
const healthFill = document.querySelector('#healthFill');
const healthText = document.querySelector('#healthText');
const heldItemEl = document.querySelector('#heldItem');
const messageEl = document.querySelector('#message');
const damageFlash = document.querySelector('#damageFlash');
const fpsEl = document.querySelector('#fps');
const bloodToggle = document.querySelector('#bloodToggle');
const attackBtn = document.querySelector('#attackBtn');
const pickupBtn = document.querySelector('#pickupBtn');
const movePad = document.querySelector('#movePad');
const moveKnob = document.querySelector('#moveKnob');

const isTouch = matchMedia('(pointer: coarse)').matches;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8c887d);
scene.fog = new THREE.Fog(0x8c887d, 18, 62);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 100);
camera.position.set(0, 1.68, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
gameEl.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xd8d2bf, 0x3e443f, 1.6));
const sun = new THREE.DirectionalLight(0xfff0cf, 2.2);
sun.position.set(-10, 22, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024,1024);
sun.shadow.camera.left = -28; sun.shadow.camera.right = 28; sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
scene.add(sun);

const world = new THREE.Group(); scene.add(world);
const npcGroup = new THREE.Group(); scene.add(npcGroup);
const pickupGroup = new THREE.Group(); scene.add(pickupGroup);
const breakableGroup = new THREE.Group(); scene.add(breakableGroup);
const effectsGroup = new THREE.Group(); scene.add(effectsGroup);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 90),
  new THREE.MeshStandardMaterial({ color: 0x444643, roughness: .97 })
);
floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; world.add(floor);

function box(x,y,z,w,h,d,color, group=world) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshStandardMaterial({color, roughness:.86}));
  m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
}

// Pavements
box(-8, .08, 0, 7.5, .16, 90, 0x78766e);
box(8, .08, 0, 7.5, .16, 90, 0x78766e);
// Road stripe
for (let z=-40; z<40; z+=7) box(0,.012,z,.18,.025,3.3,0xd2caa4);

const buildingColors = [0x5b5850,0x6e675a,0x4f5554,0x62534c];
for (let side of [-1,1]) {
  for (let i=0;i<7;i++) {
    const z=-34+i*11.5;
    const w=6+Math.random()*4;
    const h=6+Math.random()*8;
    const x=side*(13.2+Math.random()*1.2);
    box(x,h/2,z,w,h,9,buildingColors[i%buildingColors.length]);
    // Breakable window panels facing street
    for (let wy=2.6; wy<h-1; wy+=2.7) {
      for (let wx=-w/2+1.4; wx<w/2-1; wx+=2.3) {
        const panel = box(x-side*(4.52),wy,z+wx,0.08,1.25,1.25,0x819394,breakableGroup);
        panel.userData={type:'breakable',hp:1,label:'WINDOW'};
      }
    }
  }
}

// Street clutter
function makePickup(type, x, z, color, shape='box', damage=18) {
  let geo;
  if (shape==='cyl') geo = new THREE.CylinderGeometry(.16,.2,.75,8);
  else if (shape==='cone') geo = new THREE.ConeGeometry(.34,.9,10);
  else geo = new THREE.BoxGeometry(.45,.32,.9);
  const mesh = new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.8}));
  mesh.position.set(x, shape==='cone'?.45:.28, z); mesh.rotation.y=Math.random()*Math.PI;
  mesh.castShadow=true; mesh.userData={type:'pickup',label:type,damage}; pickupGroup.add(mesh); return mesh;
}
const pickupDefs = [
  ['BOTTLE',0x54715a,'cyl',22], ['BRICK',0x8a5144,'box',30], ['CONE',0xc96334,'cone',18],
  ['CAN',0x888984,'cyl',14], ['PLANK',0x7d6449,'box',26]
];
for(let i=0;i<18;i++) {
  const d=pickupDefs[i%pickupDefs.length];
  const p=makePickup(d[0], (Math.random()<.5?-1:1)*(4.8+Math.random()*4), -34+Math.random()*68, d[1], d[2], d[3]);
  if(d[0]==='PLANK') p.scale.set(.45,.22,2.5);
}

// Breakable signposts
for(let i=0;i<7;i++){
  const x=(i%2?-1:1)*6.1, z=-30+i*10;
  box(x,.9,z,.12,1.8,.12,0x4d4c48);
  const sign=box(x,1.85,z,.15,.8,1.3,0x81755a,breakableGroup);
  sign.userData={type:'breakable',hp:2,label:'SIGN'};
}

const player = {
  health:100, yaw:0, pitch:0, velocity:new THREE.Vector3(), held:null, attackCooldown:0, dodgeCooldown:0,
  dodgeTime:0, dodgeDir:0, shake:0, alive:true
};
const keys = new Set();
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0,0);
const clock = new THREE.Clock();
let running=false, lastTime=performance.now(), fpsFrames=0, fpsAccum=0, msgTimer=0;
let punchPhase=0;

function vib(pattern){ if(navigator.vibrate) navigator.vibrate(pattern); }
function showMsg(text, ms=650){ messageEl.textContent=text; messageEl.classList.add('show'); clearTimeout(msgTimer); msgTimer=setTimeout(()=>messageEl.classList.remove('show'),ms); }
function setHealth(v){ player.health=Math.max(0,Math.min(100,v)); healthFill.style.width=player.health+'%'; healthText.textContent=Math.ceil(player.health); if(player.health<=0) die(); }
function die(){ if(!player.alive)return; player.alive=false; running=false; deathScreen.classList.add('open'); document.exitPointerLock?.(); vib([120,60,180]); }

function makeNPC(x,z,variant=0){
  const g=new THREE.Group(); g.position.set(x,0,z);
  const skin=[0xcaa886,0x9a6d52,0xe1bd98,0x805e49][variant%4];
  const shirt=[0x55636b,0x734d43,0x4f684e,0x625a78,0x77715b][variant%5];
  const leg=[0x24272a,0x3d3c3c,0x29323a][variant%3];
  const body=box(0,1.12,0,.62,.95,.38,shirt,g);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.27,10,8),new THREE.MeshStandardMaterial({color:skin,roughness:.9})); head.position.y=1.83; head.castShadow=true; g.add(head);
  const lLeg=box(-.17,.45,0,.19,.85,.22,leg,g), rLeg=box(.17,.45,0,.19,.85,.22,leg,g);
  const lArm=box(-.41,1.18,0,.17,.76,.18,skin,g), rArm=box(.41,1.18,0,.17,.76,.18,skin,g);
  const hitbox=new THREE.Mesh(new THREE.BoxGeometry(.9,2.1,.75),new THREE.MeshBasicMaterial({transparent:true,opacity:0})); hitbox.position.y=1.05; g.add(hitbox);
  const data={type:'npc',hp:44+Math.random()*25,state:'wander',speed:.7+Math.random()*.55,dir:Math.random()<.5?1:-1,anger:0,attackTimer:0,stagger:0,variant, parts:{lLeg,rLeg,lArm,rArm}, root:g};
  hitbox.userData=data; body.userData=data; head.userData=data; g.userData=data; npcGroup.add(g); return g;
}
for(let i=0;i<13;i++) makeNPC((Math.random()<.5?-1:1)*(3.5+Math.random()*5),-35+Math.random()*70,i);

function bloodBurst(pos){
  if(!bloodToggle.checked) return;
  for(let i=0;i<10;i++){
    const p=new THREE.Mesh(new THREE.SphereGeometry(.035+Math.random()*.035,5,4),new THREE.MeshBasicMaterial({color:0x8f1212}));
    p.position.copy(pos); p.userData.vel=new THREE.Vector3((Math.random()-.5)*2.5,.6+Math.random()*2,(Math.random()-.5)*2.5); p.userData.life=.45+Math.random()*.4; effectsGroup.add(p);
  }
}
function debrisBurst(pos,color=0x889090){
  for(let i=0;i<8;i++){
    const p=box(pos.x,pos.y,pos.z,.06,.06,.06,color,effectsGroup); p.userData.vel=new THREE.Vector3((Math.random()-.5)*3,(Math.random())*2,(Math.random()-.5)*3); p.userData.life=.6+Math.random()*.3;
  }
}

function findNPCData(obj){ let o=obj; while(o && o!==scene){ if(o.userData?.type==='npc') return o.userData; o=o.parent; } return null; }
function doAttack(){
  if(!running || !player.alive || player.attackCooldown>0) return;
  if(player.held){ throwHeld(); return; }
  player.attackCooldown=.32; punchPhase=.22; player.shake=Math.max(player.shake,.035); vib(28);
  raycaster.setFromCamera(center,camera); raycaster.far=2.25;
  const hits=raycaster.intersectObjects(npcGroup.children,true);
  if(!hits.length){ showMsg('SWISH',220); return; }
  const npc=findNPCData(hits[0].object); if(!npc) return;
  npc.hp-=10+Math.random()*8; npc.state='angry'; npc.anger=6; npc.stagger=.25;
  npc.root.position.addScaledVector(camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize(),.18);
  bloodBurst(hits[0].point); showMsg('WHACK',280);
  if(npc.hp<=0){ npc.state='down'; npc.root.rotation.z=(Math.random()<.5?-1:1)*1.32; npc.root.position.y=.12; showMsg('FLOORED',700); }
}

function nearestPickup(){
  raycaster.setFromCamera(center,camera); raycaster.far=2.7;
  const hits=raycaster.intersectObjects(pickupGroup.children,false); return hits[0]?.object||null;
}
function pickup(){
  if(!running||!player.alive) return;
  if(player.held){ dropHeld(); return; }
  const obj=nearestPickup(); if(!obj){ showMsg('NOTHING TO GRAB',450); return; }
  player.held=obj; pickupGroup.remove(obj); scene.add(obj); obj.rotation.set(.2,.3,.15); heldItemEl.textContent='HELD: '+obj.userData.label; vib(20); showMsg('GRABBED '+obj.userData.label,400);
}
function dropHeld(){ if(!player.held)return; const o=player.held; const dir=camera.getWorldDirection(new THREE.Vector3()); o.position.copy(camera.position).add(dir.multiplyScalar(1)); o.position.y=.35; scene.remove(o); pickupGroup.add(o); player.held=null; heldItemEl.textContent='EMPTY HANDS'; }
function throwHeld(){
  const obj=player.held; if(!obj)return; const label=obj.userData.label, dmg=obj.userData.damage; player.held=null; heldItemEl.textContent='EMPTY HANDS'; scene.remove(obj); world.add(obj);
  obj.userData={type:'thrown',label,damage:dmg,vel:camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(new THREE.Vector3(0,1.1,0)),life:4};
  obj.position.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(.75));
  player.attackCooldown=.5; player.shake=.05; vib(45); showMsg('THROW',260);
}

function dodge(dir){ if(!running||player.dodgeCooldown>0)return; player.dodgeCooldown=.7; player.dodgeTime=.24; player.dodgeDir=dir; player.shake=.03; vib(18); showMsg(dir<0?'DODGE LEFT':'DODGE RIGHT',260); }

function playerHit(amount){
  if(player.dodgeTime>0){ showMsg('PERFECT DODGE',500); vib(12); return; }
  setHealth(player.health-amount); player.shake=.13; damageFlash.classList.add('on'); setTimeout(()=>damageFlash.classList.remove('on'),120); vib([70,35,70]); showMsg('HIT',250);
}

function updateNPCs(dt,t){
  for(const g of npcGroup.children){
    const n=g.userData; if(!n || n.state==='down') continue;
    const toPlayer=new THREE.Vector3(camera.position.x-g.position.x,0,camera.position.z-g.position.z); const dist=toPlayer.length();
    if(n.stagger>0){ n.stagger-=dt; continue; }
    if(n.state==='angry' || n.anger>0){
      n.anger=Math.max(0,n.anger-dt); n.state='angry';
      if(dist>1.35){ const v=toPlayer.normalize(); g.position.addScaledVector(v,n.speed*1.75*dt); g.rotation.y=Math.atan2(v.x,v.z); }
      else { n.attackTimer-=dt; if(n.attackTimer<=0){ n.attackTimer=.8+Math.random()*.6; n.parts.rArm.rotation.x=-1.6; setTimeout(()=>n.parts.rArm.rotation.x=0,180); playerHit(6+Math.random()*9); } }
      if(n.anger<=0 && dist>6) n.state='wander';
    } else {
      g.position.z += n.dir*n.speed*dt;
      if(g.position.z>39 || g.position.z<-39) n.dir*=-1;
      g.rotation.y=n.dir>0?0:Math.PI;
    }
    const walk=Math.sin(t*7*n.speed); n.parts.lLeg.rotation.x=walk*.55; n.parts.rLeg.rotation.x=-walk*.55;
  }
}

function updateThrown(dt){
  for(const o of [...world.children]){
    if(o.userData?.type!=='thrown') continue;
    o.userData.life-=dt; o.userData.vel.y-=9.8*dt; o.position.addScaledVector(o.userData.vel,dt); o.rotation.x+=8*dt; o.rotation.z+=6*dt;
    // NPC collision
    for(const n of npcGroup.children){ const d=n.userData; if(!d||d.state==='down')continue; if(o.position.distanceTo(n.position.clone().setY(1))<.8){ d.hp-=o.userData.damage; d.state='angry'; d.anger=7; d.stagger=.45; bloodBurst(o.position); debrisBurst(o.position,0x754337); showMsg('SMASH',450); o.userData.life=0; if(d.hp<=0){d.state='down';d.root.rotation.z=1.3;} break; } }
    // Breakable collision
    for(const b of [...breakableGroup.children]){ if(o.position.distanceTo(b.position)<1.15){ b.userData.hp--; debrisBurst(b.position,b.material.color.getHex()); vib(55); if(b.userData.hp<=0){ breakableGroup.remove(b); showMsg(b.userData.label+' BROKE',520); } else showMsg('CRACK',320); o.userData.life=0; break; } }
    if(o.position.y<.15 || o.userData.life<=0){ o.position.y=.24; o.userData.type='pickup'; o.userData.label=o.userData.label||'JUNK'; o.userData.damage=o.userData.damage||18; world.remove(o); pickupGroup.add(o); }
  }
}

function updateEffects(dt){
  for(const p of [...effectsGroup.children]){ p.userData.life-=dt; p.userData.vel.y-=4*dt; p.position.addScaledVector(p.userData.vel,dt); if(p.userData.life<=0) effectsGroup.remove(p); }
}

function updatePlayer(dt){
  if(player.attackCooldown>0) player.attackCooldown-=dt; if(player.dodgeCooldown>0) player.dodgeCooldown-=dt; if(player.dodgeTime>0) player.dodgeTime-=dt;

  // The camera's facing direction is always the player's forward direction.
  // Ignore vertical look (pitch) for walking so looking up/down never changes movement speed.
  camera.rotation.order='YXZ'; camera.rotation.y=player.yaw; camera.rotation.x=player.pitch; camera.rotation.z=0;
  const fwd=camera.getWorldDirection(new THREE.Vector3()); fwd.y=0; fwd.normalize();
  const right=new THREE.Vector3().crossVectors(fwd,camera.up).normalize();

  let x=0,z=0; if(keys.has('KeyW'))z+=1; if(keys.has('KeyS'))z-=1; if(keys.has('KeyA'))x-=1; if(keys.has('KeyD'))x+=1; x+=mobileMove.x; z+=mobileMove.y;
  const move=new THREE.Vector3(); move.addScaledVector(fwd,z).addScaledVector(right,x); if(move.lengthSq()>1)move.normalize();
  const speed=4.2; camera.position.addScaledVector(move,speed*dt);
  if(player.dodgeTime>0) camera.position.addScaledVector(right,player.dodgeDir*9*dt);
  camera.position.x=THREE.MathUtils.clamp(camera.position.x,-9.1,9.1); camera.position.z=THREE.MathUtils.clamp(camera.position.z,-41,41); camera.position.y=1.68;

  if(player.shake>0){ player.shake=Math.max(0,player.shake-dt*.45); camera.rotation.z+=(Math.random()-.5)*player.shake; camera.rotation.x+=(Math.random()-.5)*player.shake*.45; }
  if(player.held){ const dir=camera.getWorldDirection(new THREE.Vector3()); const target=camera.position.clone().add(dir.multiplyScalar(.8)).add(right.multiplyScalar(.45)).add(new THREE.Vector3(0,-.35,0)); player.held.position.lerp(target,.35); }
}

let mobileMove={x:0,y:0}, movePointer=null, lookPointer=null, lookLast={x:0,y:0}, lookStart={x:0,y:0,t:0};
function pointerMoveLook(dx,dy){ player.yaw-=dx*.0032; player.pitch-=dy*.003; player.pitch=THREE.MathUtils.clamp(player.pitch,-1.15,1.15); }

renderer.domElement.addEventListener('click',()=>{ if(running && !isTouch && document.pointerLockElement!==renderer.domElement) renderer.domElement.requestPointerLock(); });
document.addEventListener('mousemove',e=>{ if(running && document.pointerLockElement===renderer.domElement) pointerMoveLook(e.movementX,e.movementY); });
document.addEventListener('mousedown',e=>{ if(running && document.pointerLockElement===renderer.domElement && e.button===0) doAttack(); });
document.addEventListener('keydown',e=>{ keys.add(e.code); if(e.code==='KeyE')pickup(); if(e.code==='KeyQ')dropHeld(); });
document.addEventListener('keyup',e=>keys.delete(e.code));
let lastAD={KeyA:0,KeyD:0}; document.addEventListener('keydown',e=>{ if(e.code==='KeyA'||e.code==='KeyD'){ const now=performance.now(); if(now-lastAD[e.code]<260)dodge(e.code==='KeyA'?-1:1); lastAD[e.code]=now; } });

movePad.addEventListener('pointerdown',e=>{ movePointer=e.pointerId; movePad.setPointerCapture(e.pointerId); updatePad(e); });
movePad.addEventListener('pointermove',e=>{ if(e.pointerId===movePointer)updatePad(e); });
movePad.addEventListener('pointerup',e=>{ if(e.pointerId===movePointer){movePointer=null;mobileMove={x:0,y:0};moveKnob.style.transform='translate(-50%,-50%)';} });
function updatePad(e){ const r=movePad.getBoundingClientRect(), dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2), max=r.width*.34, len=Math.hypot(dx,dy)||1, k=Math.min(1,max/len), nx=dx*k, ny=dy*k; moveKnob.style.transform=`translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px))`; mobileMove={x:nx/max,y:-ny/max}; }

renderer.domElement.addEventListener('pointerdown',e=>{ if(!running||!isTouch||e.clientX<innerWidth*.42)return; lookPointer=e.pointerId; lookLast={x:e.clientX,y:e.clientY}; lookStart={x:e.clientX,y:e.clientY,t:performance.now()}; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove',e=>{ if(e.pointerId!==lookPointer)return; const dx=e.clientX-lookLast.x,dy=e.clientY-lookLast.y; pointerMoveLook(dx,dy); lookLast={x:e.clientX,y:e.clientY}; });
renderer.domElement.addEventListener('pointerup',e=>{ if(e.pointerId!==lookPointer)return; const dx=e.clientX-lookStart.x,dy=e.clientY-lookStart.y,dt=performance.now()-lookStart.t; if(dt<330 && Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.5)dodge(dx<0?-1:1); lookPointer=null; });
attackBtn.addEventListener('pointerdown',e=>{e.preventDefault();doAttack();}); pickupBtn.addEventListener('pointerdown',e=>{e.preventDefault();pickup();});

function start(){
  player.health=100; player.alive=true; setHealth(100); player.yaw=0; player.pitch=0; camera.position.set(0,1.68,8); running=true; startScreen.classList.remove('open'); deathScreen.classList.remove('open');
  if(!isTouch) setTimeout(()=>renderer.domElement.requestPointerLock?.(),80);
}
startBtn.addEventListener('click',start); restartBtn.addEventListener('click',()=>location.reload());

addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

function loop(now){ requestAnimationFrame(loop); const dt=Math.min(.033,clock.getDelta()); const t=now*.001;
  if(running){ updatePlayer(dt); updateNPCs(dt,t); updateThrown(dt); updateEffects(dt); }
  renderer.render(scene,camera);
  fpsFrames++; fpsAccum+=now-lastTime; lastTime=now; if(fpsAccum>650){ fpsEl.textContent=Math.round(fpsFrames/(fpsAccum/1000))+' FPS';fpsFrames=0;fpsAccum=0; }
}
requestAnimationFrame(loop);
