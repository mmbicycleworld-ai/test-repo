(() => {
  'use strict';
  const API = SUPABASE_URL + '/rest/v1/homepage_slides';
  const STORAGE = SUPABASE_URL + '/storage/v1/object';
  const BUCKET = 'homepage-slides';
  const hero = document.getElementById('home');
  const manager = document.getElementById('bannerManager');
  const status = document.getElementById('bannerStatus');
  const login = document.getElementById('bannerLogin');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let rows = [], current = 0, timer, paused = reduced.matches, busy = false, hovering = false;
  const imageURL = path => `${STORAGE}/public/${BUCKET}/${encodeURIComponent(path)}`;
  const photos = () => rows.filter(row => row.image_path);
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  function setBusy(value) {
    busy = value;
    manager.querySelectorAll('button,input,textarea').forEach(el => { el.disabled = value; });
  }
  async function request(url, options = {}) {
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(45000)});
    if (!response.ok) {
      if (response.status === 401) { login.hidden = false; throw new Error('Please sign in again to save your photos.'); }
      if (response.status === 403) throw new Error('Only the showroom owner account can change these photos.');
      throw new Error('Could not save or load photos. Check your connection and try again.');
    }
    return response;
  }
  async function headers() {
    let session = getSession();
    if (session?.refresh_token && (!session.expires_at || session.expires_at * 1000 < Date.now() + 60000)) {
      const response = await fetch(AUTH_ENDPOINT + '/token?grant_type=refresh_token', {
        method:'POST', headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:session.refresh_token}), signal:AbortSignal.timeout(20000)
      });
      if (response.ok) {
        session = await response.json();
        session.expires_at = Math.floor(Date.now()/1000) + session.expires_in;
        saveSession(session);
      } else session = null;
    }
    if (!session?.access_token) {
      login.hidden = false;
      login.scrollIntoView({block:'nearest',behavior:'smooth'});
      throw new Error('Sign in with your cloud admin account below, then upload your photos.');
    }
    return {apikey:SUPABASE_KEY,Authorization:'Bearer '+session.access_token};
  }
  login.addEventListener('submit', async event => {
    event.preventDefault();
    const email = document.getElementById('bannerEmail').value.trim();
    const password = document.getElementById('bannerPassword').value;
    setBusy(true); message('Signing in…');
    try {
      const response = await fetch(AUTH_ENDPOINT+'/token?grant_type=password', {
        method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({email,password}),signal:AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error('Sign-in failed. Check your admin email and password.');
      const session = await response.json();
      session.expires_at = Math.floor(Date.now()/1000) + session.expires_in;
      saveSession(session); login.reset(); login.hidden = true; message('Signed in. You can now upload photos.'); document.dispatchEvent(new Event('mm-cloud-signed-in'));
    } catch (error) { message(error.message,true); }
    finally { document.getElementById('bannerPassword').value=''; setBusy(false); }
  });
  document.getElementById('bannerSignIn').onclick = () => { login.hidden = !login.hidden; };
  const forgotButton = document.getElementById('bannerForgot');
  const recoveryStatus = document.getElementById('bannerRecoveryStatus');
  let recoveryCooldown = 0;
  document.getElementById('bannerShowPassword').onclick = event => {
    const input = document.getElementById('bannerPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Hide password' : 'Show password';
    event.currentTarget.setAttribute('aria-pressed', String(show));
  };
  forgotButton.onclick = async () => {
    const emailInput = document.getElementById('bannerEmail');
    if (!emailInput.reportValidity()) return;
    if (busy) return;
    if (Date.now() < recoveryCooldown) {
      recoveryStatus.textContent = 'ஒரு நிமிடம் காத்திருந்து மீண்டும் முயற்சிக்கவும்.';
      return;
    }
    setBusy(true);
    recoveryStatus.textContent = 'Reset email அனுப்பப்படுகிறது…';
    try {
      const redirect = new URL('/', location.origin).href;
      const response = await fetch(AUTH_ENDPOINT + '/recover?redirect_to=' + encodeURIComponent(redirect), {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.value.trim() }),
        signal: AbortSignal.timeout(20000)
      });
      if (response.status === 429) {
        recoveryCooldown = Date.now() + 60000;
        throw new Error('அதிக முறை முயற்சிக்கப்பட்டுள்ளது. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.');
      }
      if (!response.ok) throw new Error('Reset email அனுப்ப முடியவில்லை. Email மற்றும் இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.');
      recoveryCooldown = Date.now() + 60000;
      recoveryStatus.textContent = 'இந்த email-க்கு admin account இருந்தால் reset link வரும். Inbox / Spam பார்க்கவும். புதிய email-ல் உள்ள link-ஐத் திறந்து புதிய password அமைக்கவும்.';
    } catch (error) {
      recoveryStatus.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
        ? 'Email request முடிவை உறுதிப்படுத்த முடியவில்லை. முதலில் Inbox / Spam பார்க்கவும்; email இல்லையெனில் மீண்டும் முயற்சிக்கவும்.'
        : error.message;
    } finally { setBusy(false); }
  };
  async function load() {
    const response = await request(API+'?select=slot,image_path,caption,specifications,revision&order=slot.asc', {headers:{apikey:SUPABASE_KEY},cache:'no-store'});
    const result = await response.json();
    if (!Array.isArray(result) || result.length !== 5) throw new Error('Photo slots could not be loaded. Please retry.');
    rows = result; renderHero(); renderManager();
  }
  function resetTimer() {
    clearInterval(timer);
    if (photos().length > 1 && !paused && !hovering && !document.hidden && !hero.matches(':focus-within')) timer = setInterval(() => go(current+1),5000);
  }
  function go(index) {
    const count = photos().length;
    if (!count) return;
    current = (index + count) % count;
    const track = hero.querySelector('.slide-track');
    if (!track) return;
    track.style.transform = `translateX(-${current*100}%)`;
    hero.querySelectorAll('.slide-frame').forEach((frame,i) => { frame.setAttribute('aria-hidden',String(i!==current)); frame.inert = i !== current; });
    hero.querySelectorAll('[data-slide]').forEach((button,i) => button.setAttribute('aria-current',String(i===current)));
    resetTimer();
  }
  function specificationLines(value) {
    return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }
  function slideMarkup(row, index, count) {
    const specs = specificationLines(row.specifications);
    const name = (row.caption || '').trim();
    const title = !name || /^upcoming cycles$/i.test(name) ? 'Find your next ride.' : name;
    const enquiry = 'Hello MM Bicycle World, please share the details and availability of ' + (name || 'this cycle') + '. Photo: ' + imageURL(row.image_path);
    return `<figure class="slide-frame" role="group" aria-roledescription="slide" aria-label="${index+1} of ${count}">
      <div class="slide-photo"><span class="slide-photo-number">${String(index+1).padStart(2,'0')} / ${String(count).padStart(2,'0')}</span><img src="${imageURL(row.image_path)}" alt="${esc(name || 'Upcoming cycle')}" ${index?'loading="lazy"':'fetchpriority="high"'}></div>
      <figcaption class="slide-details"><p class="slide-brand">MM BICYCLE WORLD</p><h3>${esc(title)}</h3>
      ${specs.length ? `<p class="slide-detail-label">CYCLE HIGHLIGHTS</p><ul class="slide-specs">${specs.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>` : '<p class="slide-intro">Explore cycles for your next adventure.</p><div class="slide-visit"><span>VISIT OUR SHOWROOM</span><strong>Thirubuvanai, Puducherry</strong><p>10:00 AM – 9:00 PM · Every day</p></div>'}
      <a class="slide-enquire" href="https://wa.me/919677367969?text=${encodeURIComponent(enquiry)}" target="_blank" rel="noopener noreferrer">Enquire on WhatsApp <span aria-hidden="true">↗</span></a><p class="slide-phone">Call <a href="tel:+919677367969">96773 67969</a></p></figcaption></figure>`;
  }
  function renderHero() {
    hero.querySelector('.upcoming-carousel')?.remove();
    const slides = photos();
    hero.classList.toggle('has-slides',slides.length > 0);
    clearInterval(timer);
    if (!slides.length) return;
    const root = document.createElement('div'); root.className='upcoming-carousel';
    root.setAttribute('role','region'); root.setAttribute('aria-roledescription','carousel'); root.setAttribute('aria-label','Upcoming Cycles');
    root.innerHTML = `<div class="slide-heading"><h2>UPCOMING CYCLES</h2><p>EXPLORE · ADVENTURE · COMMUNITY</p></div><div class="slide-viewport"><div class="slide-track">${slides.map((row,i)=>slideMarkup(row,i,slides.length)).join('')}</div></div><div class="slide-controls" ${slides.length<2?'hidden':''}><button type="button" data-direction="-1" aria-label="Previous photo">❮</button>${slides.map((_,i)=>`<button type="button" data-slide="${i}" aria-label="Show photo ${i+1}">${i+1}</button>`).join('')}<button type="button" data-direction="1" aria-label="Next photo">❯</button><button type="button" class="slide-pause">${paused?'Play':'Pause'}</button></div>`;
    hero.appendChild(root);
    root.querySelectorAll('[data-slide]').forEach(button => button.onclick=()=>go(Number(button.dataset.slide)));
    root.querySelectorAll('[data-direction]').forEach(button => button.onclick=()=>go(current+Number(button.dataset.direction)));
    root.querySelector('.slide-pause').onclick = event => { paused=!paused; event.target.textContent=paused?'Play':'Pause'; resetTimer(); };
    let start;
    const viewport=root.querySelector('.slide-viewport');
    viewport.addEventListener('touchstart',event=>{start={x:event.touches[0].clientX,y:event.touches[0].clientY};},{passive:true});
    viewport.addEventListener('touchend',event=>{if(!start)return;const dx=event.changedTouches[0].clientX-start.x,dy=event.changedTouches[0].clientY-start.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))go(current+(dx<0?1:-1));start=null;},{passive:true});
    go(Math.min(current,slides.length-1));
  }
  hero.addEventListener('mouseenter',()=>{hovering=true;resetTimer();});
  hero.addEventListener('mouseleave',()=>{hovering=false;resetTimer();});
  hero.addEventListener('focusin',resetTimer);
  hero.addEventListener('focusout',()=>setTimeout(resetTimer,0));
  hero.addEventListener('keydown',event=>{if(!photos().length)return;if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();go(current+(event.key==='ArrowRight'?1:-1));}});
  document.addEventListener('visibilitychange',resetTimer);
  reduced.addEventListener('change',()=>{paused=reduced.matches;renderHero();});
  function renderManager() {
    document.getElementById('bannerSlots').innerHTML=rows.map(row=>`<div class="banner-slot" data-slot="${row.slot}"><div>${row.image_path?`<img src="${imageURL(row.image_path)}" alt="Photo ${row.slot}">`:`<div class="banner-empty">Photo ${row.slot} / 5</div>`}</div><div><label for="caption${row.slot}">Photo ${row.slot} — Model name / title</label><input type="text" id="caption${row.slot}" maxlength="100" value="${esc(row.caption)}"><label class="banner-spec-label" for="specifications${row.slot}">Specifications / விவரங்கள் (optional)</label><textarea id="specifications${row.slot}" rows="4" maxlength="800" placeholder="ஒவ்வொரு வரியிலும் ஒரு விவரம்: Wheel size, Gears, Frame, Brakes…">${esc(row.specifications||'')}</textarea><small class="banner-spec-help">உறுதிப்படுத்திய விவரங்களை மட்டும் எழுதுங்கள். காலியாக விட்டால் showroom விவரங்கள் தெரியும்.</small><input type="file" id="photo${row.slot}" accept="image/jpeg,image/png,image/webp" hidden><div class="banner-actions"><button type="button" class="banner-upload" data-action="upload">${row.image_path?'Replace photo':'Upload photo'}</button><button type="button" data-action="caption">Save details</button>${row.image_path?'<button type="button" class="banner-remove" data-action="remove">Remove</button>':''}</div></div></div>`).join('');
    document.getElementById('bannerCount').textContent=`${photos().length} / 5 photos`;
    manager.querySelectorAll('.banner-slot').forEach(slot=>{
      const id=Number(slot.dataset.slot),input=slot.querySelector('input[type=file]');
      slot.querySelector('[data-action=upload]').onclick=()=>input.click();
      input.onchange=()=>{const file=input.files[0];if(file)run(()=>upload(id,file));input.value='';};
      slot.querySelector('[data-action=caption]').onclick=()=>run(()=>saveCaption(id));
      const remove=slot.querySelector('[data-action=remove]');
      if(remove)remove.onclick=()=>{if(confirm(`Remove photo ${id} from the homepage?`))run(()=>removePhoto(id));};
    });
    if (busy) setBusy(true);
  }
  async function run(action) {
    if(busy)return;setBusy(true);message('Saving…');
    try {await action();await load();message('Saved. Your homepage is updated for everyone.');}
    catch(error){message(error.message,true);}
    finally{setBusy(false);}
  }
  async function update(row,values,auth) {
    const response=await request(`${API}?slot=eq.${row.slot}&revision=eq.${row.revision}`,{
      method:'PATCH',headers:{...auth,'Content-Type':'application/json',Prefer:'return=representation'},
      body:JSON.stringify({...values,revision:row.revision+1})
    });
    const saved=await response.json();
    if(!saved.length)throw new Error('This photo was changed on another device. Press Reload photos, then try again.');
    rows=rows.map(item=>item.slot===row.slot?saved[0]:item);
  }
  async function compress(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG or WebP photo.');
    if(file.size>20*1024*1024)throw new Error('Choose a photo smaller than 20 MB.');
    const url=URL.createObjectURL(file);
    try {
      const image=new Image();image.src=url;await image.decode();
      const ratio=Math.min(1,1920/Math.max(image.width,image.height));
      const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.86));
      if(!blob||blob.size>2097152)throw new Error('This photo is too large. Choose a smaller image.');return blob;
    } finally {URL.revokeObjectURL(url);}
  }
  async function deleteImage(path,auth) {
    if(!path)return;
    await request(`${STORAGE}/${BUCKET}`,{method:'DELETE',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});
  }
  async function upload(id,file) {
    const auth=await headers(),row=rows.find(row=>row.slot===id);
    if(!row)throw new Error('Reload photos and try again.');
    const blob=await compress(file),path=`slide-${id}-${crypto.randomUUID()}.jpg`;
    const details=readSlideDetails(id);
    await request(`${STORAGE}/${BUCKET}/${path}`,{method:'POST',headers:{...auth,'Content-Type':'image/jpeg','Cache-Control':'max-age=31536000'},body:blob});
    try {await update(row,{image_path:path,...details},auth);}
    catch(error){
      // A lost response may still have committed. Never remove an image that might be live.
      try {const check=await request(`${API}?slot=eq.${id}&select=image_path`,{headers:{apikey:SUPABASE_KEY},cache:'no-store'});const latest=await check.json();if(latest[0]?.image_path!==path)await deleteImage(path,auth);}catch{}
      throw error;
    }
    // Removing an unreferenced old image must not turn a successful save into a failure.
    try {await deleteImage(row.image_path,auth);}catch{}
  }
  function readSlideDetails(id) {
    return {caption:document.getElementById('caption'+id).value.trim()||'Upcoming Cycles',specifications:document.getElementById('specifications'+id).value.trim()};
  }
  async function saveCaption(id){const row=rows.find(row=>row.slot===id),auth=await headers();await update(row,readSlideDetails(id),auth);}
  async function removePhoto(id){const row=rows.find(row=>row.slot===id),auth=await headers();await update(row,{image_path:null},auth);try{await deleteImage(row.image_path,auth);}catch{}}
  document.getElementById('bannerBulkButton').onclick=()=>document.getElementById('bannerBulk').click();
  document.getElementById('bannerBulk').onchange=event=>{
    const files=[...event.target.files];event.target.value='';if(!files.length)return;
    const empty=rows.filter(row=>!row.image_path);
    if(files.length>empty.length){message(`You can add ${empty.length} more photo(s). Maximum 5 photos. Use Replace photo to change an existing photo.`,true);return;}
    run(async()=>{await headers();for(let i=0;i<files.length;i++){message(`Uploading photo ${i+1} of ${files.length}…`);try{await upload(empty[i].slot,files[i]);}catch(error){renderHero();renderManager();throw new Error(`${i} of ${files.length} saved. ${error.message}`);}}});
  };
  document.getElementById('bannerReload').onclick=async()=>{if(busy)return;setBusy(true);try{await load();message('Photos reloaded.');}catch(error){message(error.message,true);}finally{setBusy(false);}};
  window.mmShowroomMedia = {authHeaders:headers,compressImage:compress,showSignIn:()=>{login.hidden=false;login.scrollIntoView({block:'center',behavior:'smooth'});document.getElementById('bannerEmail').focus();}};
  load().then(()=>message('Upload up to 5 photos. Each photo appears for 5 seconds.')).catch(error=>message(error.message,true));
})();
