(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const street = $("street"), ctx = street.getContext("2d");
  const print = $("print"), detail = $("detail"), inspect = $("inspect");
  const world = window.ALLEY, width = world.width || 640, height = world.height || 360;
  const speed = world.speed || 82;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const keys = new Set(), touchPointers = new Map();
  const images = {}, plates = {}, slots = {}, collected = new Map();
  const allWalls = Object.values(world.locations).flatMap(place => place.walls);
  const moveKeys = ["KeyA", "KeyD", "ArrowLeft", "ArrowRight"];
  const paper = "#e8d1a7";
  const drawHint = "按住鼠标或用手指圈选，松开后自动闭合。";
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let locationId = world.initial, scene = world.locations[locationId];
  let player = [scene.spawnX, scene.groundY], facing = 1, stride = 0, moving = false;
  let destination = null, pending = null, entryGuide = null, transition = null;
  let active = null, nearby = null, cutTime = null, cutLength = 0;
  let stroke = null, selection = null;
  let ready = false, previous = 0, lastNotice = 0;
  const ground = document.createElement("canvas"), backdrop = document.createElement("canvas");
  ground.width = backdrop.width = width;
  ground.height = backdrop.height = height;

  function inform(message) {
    $("notice").textContent = message;
    $("notice").classList.add("visible");
    clearTimeout(lastNotice);
    lastNotice = setTimeout(() => $("notice").classList.remove("visible"), 1900);
  }
  function load(src) {
    return new Promise((resolve, reject) => {
      const bitmap = new Image();
      bitmap.onload = () => resolve(bitmap);
      bitmap.onerror = () => reject(new Error(src));
      bitmap.src = src;
    });
  }
  function contour(context, points, w, h, closed=true) {
    context.beginPath();
    points.forEach(([u,v],i) => {
      if (i === 0) context.moveTo(u*w,v*h);
      else context.lineTo(u*w,v*h);
    });
    if (closed) context.closePath();
  }
  function printHole(c, points, w, h) {
    c.save();
    contour(c,points,w,h);
    c.fillStyle = paper;
    c.fill("evenodd");
    c.strokeStyle = "#655644";
    c.lineWidth = w/350;
    c.stroke();
    c.clip("evenodd");
    // The revealed older paper has a sparse, printed diagonal hatch.
    c.strokeStyle = "#ac93674b";
    c.lineWidth = w/600;
    c.beginPath();
    for (let x = -h; x < w; x += w/27) {
      c.moveTo(x, h);
      c.lineTo(x+h, 0);
    }
    c.stroke();
    c.restore();
  }
  function rebuildPlate(wall) {
    const img = images[wall.id];
    const buffer = plates[wall.id] || document.createElement("canvas");
    // Small pixel posters remain large enough to trace in the inspection dialog.
    const plateScale = Math.max(1,Math.ceil(480/img.naturalWidth));
    buffer.width = Math.min(850,img.naturalWidth*plateScale);
    buffer.height = Math.round(buffer.width*img.naturalHeight/img.naturalWidth);
    const c = buffer.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.drawImage(img,0,0,buffer.width,buffer.height);
    if (collected.has(wall.id)) {
      printHole(c,collected.get(wall.id),buffer.width,buffer.height);
    }
    plates[wall.id] = buffer;
  }
  function drawQuad(c, img, quad) {
    const [tl,tr,br,bl] = quad;
    const drawFace = (points, origin, horizontal, vertical) => {
      c.save();
      c.beginPath();
      c.moveTo(...points[0]); c.lineTo(...points[1]); c.lineTo(...points[2]);
      c.closePath(); c.clip();
      c.transform(horizontal[0]/img.width, horizontal[1]/img.width,
        vertical[0]/img.height,vertical[1]/img.height,origin[0],origin[1]);
      c.drawImage(img,0,0);
      c.restore();
    };
    drawFace([tl,tr,bl],tl,[tr[0]-tl[0],tr[1]-tl[1]],[bl[0]-tl[0],bl[1]-tl[1]]);
    const o = [tr[0]+bl[0]-br[0],tr[1]+bl[1]-br[1]];
    drawFace([tr,br,bl],o,[br[0]-bl[0],br[1]-bl[1]],[br[0]-tr[0],br[1]-tr[1]]);
  }

  function paintGround() {
    const b = backdrop.getContext("2d"), c = ground.getContext("2d");
    b.imageSmoothingEnabled = c.imageSmoothingEnabled = false;
    b.clearRect(0,0,width,height);
    b.drawImage(images["map-"+locationId],0,0,width,height);
    c.clearRect(0,0,width,height);
    c.drawImage(backdrop,0,0);
    for (const wall of scene.walls) {
      rebuildPlate(wall);
      drawQuad(c,plates[wall.id],wall.quad);
    }
  }

  function buildBag() {
    const holder = $("scraps");
    holder.replaceChildren();
    for (const wall of allWalls) {
      const slot = document.createElement("canvas");
      slot.width=80; slot.height=90;
      slot.className="slot"; slot.setAttribute("aria-label", "空报袋格");
      holder.append(slot); slots[wall.id]=slot;
    }
    $("count").textContent = "0/" + allWalls.length;
  }
  function drawClipping(slot,img,points) {
    const c = slot.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.clearRect(0,0,slot.width,slot.height);
    const xs = points.map(p=>p[0]*img.width), ys = points.map(p=>p[1]*img.height);
    const x = Math.min(...xs), y=Math.min(...ys);
    const w=Math.max(...xs)-x, h=Math.max(...ys)-y;
    const scale=Math.min((slot.width-7)/w,(slot.height-7)/h);
    c.save();
    c.translate((slot.width-w*scale)/2,(slot.height-h*scale)/2);
    c.scale(scale,scale); c.translate(-x,-y);
    contour(c,points,img.width,img.height);
    c.strokeStyle="#fff5dc"; c.lineWidth=3/scale; c.stroke(); c.clip("evenodd"); c.drawImage(img,0,0); c.restore();
  }
  function addScrap(wall,points) {
    const slot = slots[wall.id];
    drawClipping(slot,images[wall.id],points);
    slot.classList.add("filled"); slot.setAttribute("aria-label",wall.name+"剪片");
    $("count").textContent = collected.size+"/"+allWalls.length;
  }

  function pointIn(pos, quad) {
    let inside = false;
    for (let i=0,j=quad.length-1;i<quad.length;j=i++) {
      const [xi,yi]=quad[i], [xj,yj]=quad[j];
      if ((yi>pos[1])!==(yj>pos[1]) && pos[0]<(xj-xi)*(pos[1]-yi)/(yj-yi)+xi) inside=!inside;
    }
    return inside;
  }
  function nearbyWall() {
    if (active || transition || entryGuide) return null;
    return scene.walls.find(wall => Math.abs(wall.interactX-player[0])<=27) || null;
  }
  function updateNearby() {
    const next = nearbyWall();
    if (nearby===next) return;
    nearby = next;
    inspect.hidden = !nearby;
    if (nearby) {
      inspect.style.left = ((nearby.quad[0][0]+nearby.quad[1][0])/2/width*100)+"%";
      inspect.style.top = ((Math.min(nearby.quad[0][1],nearby.quad[1][1])-6)/height*100)+"%";
    }
  }
  function cancelRoute() { destination=null; pending=null; }
  function clearInput() {
    keys.clear();
    const held = [...touchPointers.entries()];
    touchPointers.clear();
    for (const [id, item] of held) {
      item.button.classList.remove("pressed");
      if (item.button.hasPointerCapture(id)) item.button.releasePointerCapture(id);
    }
  }
  function enterLocation(id, direction=0) {
    locationId=id; scene=world.locations[id];
    const depth = 12;
    player=[direction>0 ? depth : direction<0 ? width-depth : scene.spawnX,scene.groundY];
    facing=direction || 1; stride=0;
    cancelRoute(); nearby=null; inspect.hidden=true;
    // Complete the short entrance even if a click-to-walk journey released its input.
    // Travel stays disarmed until the player has emerged past the incoming wall.
    entryGuide=direction ? {direction, goal:direction>0 ? scene.occlusion.left+24 : width-scene.occlusion.right-24} : null;
    $("place").textContent=scene.name;
    paintGround(); updateNearby();
  }
  function beginTransition(direction) {
    const to=scene.neighbors[direction<0?"left":"right"];
    if (!to) return;
    transition={to,direction,elapsed:0};
    moving=false; cancelRoute(); nearby=null; inspect.hidden=true;
  }
  function advanceTransition(dt) {
    transition.elapsed+=dt;
    // No full-screen fade: the outgoing player is already concealed by architecture.
    if (transition.elapsed<.10) return;
    const {to,direction}=transition;
    transition=null;
    enterLocation(to,direction);
  }
  function reset() {
    if (active) closePoster();
    clearInput(); collected.clear(); transition=null; entryGuide=null;
    cutTime=null; stroke=null; selection=null; moving=false;
    clearTimeout(lastNotice); $("notice").classList.remove("visible");
    buildBag(); enterLocation(world.initial); previous=0;
  }
  function sizeCanvas() {
    // Keep the backing canvas at native pixel-art resolution, independent of DPR.
    if (street.width!==width) street.width=width;
    if (street.height!==height) street.height=height;
    ctx.imageSmoothingEnabled=false;
  }
  function heroDimensions() {
    const img=images.hero, sheet=world.hero || {};
    const frameW=sheet.frameWidth || Math.floor(img.naturalWidth/(sheet.frames || 1));
    const frameH=sheet.frameHeight || img.naturalHeight;
    const h=world.playerHeight || 35;
    return {frameW,frameH,h,w:Math.round(h*frameW/frameH)};
  }
  function drawHero() {
    const sheet=world.hero || {}, {frameW,frameH,w,h}=heroDimensions();
    const frames=sheet.frames || 1;
    const frame=moving && !reduced ? Math.floor(stride/(speed/(sheet.fps || 8)))%frames : (sheet.idleFrame || 0);
    const bob=moving && !reduced && Math.floor(stride/5)%2 ? 1 : 0;
    const x=Math.round(player[0]), y=Math.round(player[1]);
    ctx.fillStyle="#202b3b77";
    ctx.fillRect(x-Math.floor(w*.42),y-1,Math.round(w*.84),2);
    ctx.save(); ctx.translate(x,y-bob);
    if (facing!==(world.heroFaces==="left"?-1:1)) ctx.scale(-1,1);
    ctx.drawImage(images.hero,frame*frameW,0,frameW,frameH,-Math.floor(w/2),-h,w,h);
    ctx.restore();
  }
  function drawStreet() {
    ctx.imageSmoothingEnabled=false;
    ctx.clearRect(0,0,width,height);
    ctx.drawImage(ground,0,0);
    drawHero();
    // These strips are genuinely painted AFTER the actor. Each background's edge
    // architecture is therefore a foreground occluder rather than a trigger sign.
    const left=scene.occlusion.left, right=scene.occlusion.right;
    if (left) ctx.drawImage(backdrop,0,0,left,height,0,0,left,height);
    if (right) ctx.drawImage(backdrop,width-right,0,right,height,width-right,0,right,height);
    street.dataset.location=locationId;
    street.dataset.x=player[0].toFixed(2);
    street.dataset.y=player[1].toFixed(2);
    street.dataset.transition=transition?"covered":entryGuide?"entering":"";
    street.dataset.moving=String(moving);
    street.dataset.occluded=String(player[0]<left || player[0]>width-right);
  }
  function walk(dt) {
    let axis=Number(keys.has("KeyD") || keys.has("ArrowRight"))-Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    for (const held of touchPointers.values()) axis+=held.direction;
    axis=Math.sign(axis);
    if (axis) cancelRoute();
    const oldX=player[0];
    if (entryGuide) {
      axis=entryGuide.direction;
      const step=axis*speed*dt;
      player[0]=axis>0 ? Math.min(entryGuide.goal,oldX+step) : Math.max(entryGuide.goal,oldX+step);
      if (Math.abs(player[0]-entryGuide.goal)<.01) entryGuide=null;
    } else if (axis) {
      player[0]+=axis*speed*dt;
    } else if (destination!==null) {
      axis=Math.sign(destination-player[0]);
      player[0]+=axis*Math.min(Math.abs(destination-player[0]),speed*dt);
      if (Math.abs(destination-player[0])<.01) {
        destination=null;
        const target=pending; pending=null;
        if (target) openPoster(target);
      }
    }
    const half=Math.ceil(heroDimensions().w/2);
    const minX=scene.neighbors.left?12:scene.occlusion.left+half+2;
    const maxX=scene.neighbors.right?width-12:width-scene.occlusion.right-half-2;
    player[0]=clamp(player[0],minX,maxX);
    const distance=Math.abs(player[0]-oldX);
    moving=distance>.001 && !active;
    if (moving) { facing=axis; stride+=distance; }
    if (!entryGuide && !active) {
      if (axis<0 && player[0]<=12 && scene.neighbors.left) beginTransition(-1);
      else if (axis>0 && player[0]>=width-12 && scene.neighbors.right) beginTransition(1);
    }
    updateNearby();
  }

  function renderPrint(progress=0) {
    if (!active) return;
    const poster=plates[active.id], c=print.getContext("2d");
    if (print.width!==poster.width || print.height!==poster.height) {print.width=poster.width; print.height=poster.height;}
    c.imageSmoothingEnabled=false;
    c.drawImage(poster,0,0);
    const points=stroke ? stroke.points : selection;
    if (!points || points.length < 2) return;
    c.save(); c.lineJoin="round"; c.lineCap="round";
    if (!stroke) {
      contour(c,points,print.width,print.height);
      c.rect(0,0,print.width,print.height);
      c.fillStyle="rgba(24,32,49,.32)";
      c.fill("evenodd");
    }
    contour(c,points,print.width,print.height,!stroke);
    c.lineWidth=print.width*.007; c.strokeStyle="#fff5d9"; c.stroke();
    c.lineWidth=print.width*.0035; c.strokeStyle="#a33524";
    if (!stroke) c.setLineDash([print.width*.012,print.width*.008]);
    c.stroke(); c.setLineDash([]);
    if (progress>0) {
      c.lineWidth=print.width*.008; c.strokeStyle="#d54b2f"; c.setLineDash([Math.max(1,progress*cutLength),cutLength]); c.stroke();
    }
    c.restore();
  }
  function updateCutUI(hint) {
    const saved=collected.has(active.id);
    print.classList.toggle("editable",!saved && cutTime===null);
    $("cut").hidden=saved;
    $("cut").disabled=!selection || cutTime!==null;
    $("redraw").hidden=!selection || cutTime!==null;
    $("sample-box").hidden=!selection;
    $("cut-hint").textContent=hint;
  }
  function releaseStroke() {
    if (!stroke) return;
    const id=stroke.id;
    stroke=null;
    if (print.hasPointerCapture(id)) print.releasePointerCapture(id);
  }
  function clearSelection(hint=drawHint) {
    releaseStroke();
    selection=null;
    updateCutUI(hint);
    renderPrint();
  }
  function appendSamples(events) {
    const box=print.getBoundingClientRect();
    let points=stroke.points;
    for (const event of events) {
      const u=clamp((event.clientX-box.left)/box.width,0,1);
      const v=clamp((event.clientY-box.top)/box.height,0,1);
      const last=points[points.length-1];
      if (last && Math.hypot((u-last[0])*box.width,(v-last[1])*box.height)<1.3) continue;
      if (points.length>=4096) points=stroke.points=points.filter((_,i)=>i%2===0);
      points.push([u,v]);
    }
  }
  // Measure continuous even-odd spans in CSS pixels. A tiny raster mask can turn
  // antialiasing along a long diagonal into a falsely large area after scaling.
  // Splitting at vertices is exact for simple/concave polygons; subpixel slices
  // also retain crossed freehand loops without signed-area cancellation.
  function enoughPaper(points) {
    if (points.length<3) return false;
    const box=print.getBoundingClientRect();
    const scaled=points.map(([u,v])=>[u*box.width,v*box.height]);
    const xs=scaled.map(p=>p[0]), ys=scaled.map(p=>p[1]);
    if (Math.max(...xs)-Math.min(...xs)<4 || Math.max(...ys)-Math.min(...ys)<4) return false;
    let perimeter=0, area=0;
    const edges=[];
    scaled.forEach(([x,y],i)=>{
      const [nx,ny]=scaled[(i+1)%scaled.length];
      perimeter+=Math.hypot(nx-x,ny-y);
      if (ny!==y) edges.push({x,y,slope:(nx-x)/(ny-y),low:Math.min(y,ny),high:Math.max(y,ny)});
    });
    if (!perimeter) return false;
    edges.sort((a,b)=>a.low-b.low);
    let edgeIndex=0, activeEdges=[];
    const levels=[...new Set(ys)].sort((a,b)=>a-b);
    for (let i=1;i<levels.length;i++) {
      const low=levels[i-1], span=levels[i]-low;
      const slices=Math.max(1,Math.ceil(span/.5)), dy=span/slices;
      for (let slice=0;slice<slices;slice++) {
        const y=low+(slice+.5)*dy, crossings=[];
        while (edgeIndex<edges.length && edges[edgeIndex].low<y) activeEdges.push(edges[edgeIndex++]);
        activeEdges=activeEdges.filter(edge=>edge.high>y);
        for (const edge of activeEdges) crossings.push(edge.x+(y-edge.y)*edge.slope);
        crossings.sort((a,b)=>a-b);
        for (let j=0;j+1<crossings.length;j+=2) area+=(crossings[j+1]-crossings[j])*dy;
      }
    }
    // 2A/P approximates the width of a long strip. Reject accidental hairline
    // drags while retaining deliberate narrow, concave and self-crossing shapes.
    return area>=32 && 2*area/perimeter>=2;
  }
  print.addEventListener("pointerdown",event=>{
    if (!active || collected.has(active.id) || cutTime!==null || stroke || !event.isPrimary || event.button!==0) return;
    // touch-action on the drawing surface already prevents touch panning.
    if (event.pointerType==="mouse") event.preventDefault();
    selection=null;
    stroke={id:event.pointerId,points:[]};
    print.setPointerCapture(event.pointerId);
    updateCutUI("沿着想剪的边缘画，松开即可预览。");
    appendSamples([event]); renderPrint();
  });
  print.addEventListener("pointermove",event=>{
    if (stroke?.id!==event.pointerId) return;
    const samples=event.getCoalescedEvents?.() || [];
    appendSamples(samples.length ? [...samples,event] : [event]);
    renderPrint();
  });
  print.addEventListener("pointerup",event=>{
    if (stroke?.id!==event.pointerId) return;
    appendSamples([event]);
    const points=stroke.points;
    releaseStroke();
    if (!enoughPaper(points)) {
      clearSelection("圈出的纸片太小或太细。按住再画一圈。");
      return;
    }
    selection=points;
    drawClipping($("sample"),images[active.id],selection);
    updateCutUI("亮起的部分会剪进报袋。也可以重新圈选。");
    renderPrint();
  });
  function cancelStroke(event) {
    if (stroke?.id===event.pointerId) clearSelection();
  }
  print.addEventListener("pointercancel",cancelStroke);
  print.addEventListener("lostpointercapture",cancelStroke);

  function openPoster(wall) {
    if (active || !ready || transition || entryGuide) return;
    cancelRoute(); clearInput(); moving=false; active=wall; cutTime=null;
    const centerX=(wall.quad[0][0]+wall.quad[2][0])/2;
    if (Math.abs(centerX-player[0])>1) facing=centerX<player[0]?-1:1;
    const saved=collected.has(wall.id);
    $("poster-title").textContent=wall.name;
    inspect.hidden=true; nearby=null;
    clearSelection(saved?"这张剪片已收进报袋。":drawHint);
    detail.showModal();
    $("back").focus({preventScroll:true});
  }
  function closePoster() {
    if (!active) return;
    releaseStroke(); selection=null;
    active=null; cutTime=null; clearInput(); detail.close();
    street.focus({preventScroll:true}); updateNearby();
  }

  function startCut() {
    if (!active || !selection || stroke || collected.has(active.id) || cutTime!==null) return;
    cutLength=selection.reduce((sum,p,i)=>{
      const q=selection[(i+1)%selection.length];
      return sum+Math.hypot((p[0]-q[0])*print.width,(p[1]-q[1])*print.height);
    },0);
    cutTime=performance.now(); updateCutUI("正在沿轮廓剪下…");
  }
  function finishCut() {
    const wall=active, points=selection;
    collected.set(wall.id,points); addScrap(wall,points); paintGround(); closePoster();
    inform(collected.size===allWalls.length?"三张剪片都收进报袋了":"剪片已收入报袋");
  }

  function tick(time) {
    if (ready) {
      const dt=previous?Math.min((time-previous)/1000,.05):0;
      if (transition) advanceTransition(dt);
      else if (!active) walk(dt);
      if (cutTime!==null) {
        const progress=(time-cutTime)/(reduced?130:640);
        if (progress>=1) finishCut(); else renderPrint(progress);
      }
      drawStreet();
    }
    previous=time;
    requestAnimationFrame(tick);
  }
  function eventPos(event) {
    const rect=street.getBoundingClientRect();
    return [(event.clientX-rect.left)/rect.width*width,(event.clientY-rect.top)/rect.height*height];
  }
  street.addEventListener("pointerdown",event=>{
    if (!ready || active || transition || entryGuide || event.button!==0) return;
    event.preventDefault(); street.focus({preventScroll:true});
    const pos=eventPos(event), wall=scene.walls.find(w=>pointIn(pos,w.quad));
    cancelRoute();
    if (wall && nearbyWall()===wall) openPoster(wall);
    else if (wall) { destination=wall.interactX; pending=wall; }
    else {
      const half=Math.ceil(heroDimensions().w/2);
      const left=scene.neighbors.left?12:scene.occlusion.left+half+2;
      const right=scene.neighbors.right?width-12:width-scene.occlusion.right-half-2;
      // Tapping an edge means walking all the way behind its foreground wall.
      destination=pos[0]<scene.occlusion.left+8 && scene.neighbors.left ? left
        : pos[0]>width-scene.occlusion.right-8 && scene.neighbors.right ? right
        : clamp(pos[0],left,right);
    }
  });
  street.addEventListener("pointermove",event=>{
    if (!ready || active) return;
    const pos=eventPos(event);
    street.style.cursor=scene.walls.some(w=>pointIn(pos,w.quad))?"pointer":"crosshair";
  });
  document.addEventListener("keydown",event=>{
    if (!ready || event.ctrlKey || event.metaKey || event.altKey) return;
    if (active) {
      if (event.code==="KeyE" && !event.repeat) {event.preventDefault(); startCut();}
      return;
    }
    if (event.code==="KeyR" && !event.repeat) {event.preventDefault(); reset(); return;}
    // Keep held movement keys through covered transitions, so walking never stalls.
    if (moveKeys.includes(event.code)) {event.preventDefault(); keys.add(event.code); cancelRoute();}
    else if (event.code==="KeyE" && !event.repeat && nearbyWall()) {event.preventDefault(); openPoster(nearbyWall());}
  });
  document.addEventListener("keyup",event=>keys.delete(event.code));
  for (const [id,direction] of [["move-left",-1],["move-right",1]]) {
    const button=$(id);
    button.addEventListener("pointerdown",event=>{
      if (!ready || active || event.button!==0) return;
      event.preventDefault(); cancelRoute();
      touchPointers.set(event.pointerId,{button,direction});
      button.setPointerCapture(event.pointerId); button.classList.add("pressed");
    });
    const release=event=>{
      touchPointers.delete(event.pointerId);
      if (![...touchPointers.values()].some(item=>item.button===button)) button.classList.remove("pressed");
    };
    button.addEventListener("pointerup",release);
    button.addEventListener("pointercancel",release);
    button.addEventListener("lostpointercapture",release);
    button.addEventListener("contextmenu",event=>event.preventDefault());
  }
  function loseInput() {
    clearInput(); cancelRoute();
    if (stroke) clearSelection();
  }
  window.addEventListener("blur",loseInput);
  document.addEventListener("visibilitychange",()=>{if(document.hidden){loseInput();previous=0;}});
  inspect.addEventListener("click",()=>{if (nearby) openPoster(nearby);});
  $("cut").addEventListener("click",startCut);
  $("redraw").addEventListener("click",()=>clearSelection());
  $("back").addEventListener("click",closePoster);

  // A browser can suppress its generated click immediately after a drawn touch
  // gesture. Activate a deliberate button tap at touchend and suppress its duplicate.
  const toolsPanel=detail.querySelector(".tools");
  let buttonTap=null;
  toolsPanel.addEventListener("touchstart",event=>{
    const button=event.target.closest("button");
    const finger=event.touches[0];
    buttonTap=button && !button.disabled && event.touches.length===1
      ? {button,id:finger.identifier,x:finger.clientX,y:finger.clientY} : null;
  },{passive:true});
  toolsPanel.addEventListener("touchcancel",()=>{buttonTap=null;});
  toolsPanel.addEventListener("touchend",event=>{
    const tap=buttonTap;
    buttonTap=null;
    if (!tap || event.touches.length || !event.cancelable) return;
    const finger=event.changedTouches[0];
    if (finger.identifier!==tap.id) return;
    const underFinger=document.elementFromPoint(finger.clientX,finger.clientY);
    event.preventDefault();
    if (tap.button.contains(underFinger) && Math.hypot(finger.clientX-tap.x,finger.clientY-tap.y)<12) {
      tap.button.click();
    }
  },{passive:false});

  detail.addEventListener("cancel",event=>{event.preventDefault(); closePoster();});
  $("restart").addEventListener("click",()=>{if (ready) reset();});
  new ResizeObserver(sizeCanvas).observe(street);
  async function start() {
    const maps=Object.entries(world.locations).map(([id,place])=>["map-"+id,place.image]);
    const entries=[...maps,["hero",world.hero?.image || "assets/hero.png"],...allWalls.map(w=>[w.id,w.image || "assets/"+w.id+".png"])];
    try {
      await Promise.all(entries.map(async ([name,src])=>{images[name]=await load(src);}));
    } catch (error) {
      $("loading").textContent="无法打开图片："+error.message; return;
    }
    ready=true; sizeCanvas(); reset(); $("loading").hidden=true;
    requestAnimationFrame(tick);
  }
  start();
})();
