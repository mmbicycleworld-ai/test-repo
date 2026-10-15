(() => {
  'use strict';
  const CATEGORIES = [
    ['junior','Junior Kids'],['senior','Senior Kids'],['adult','Adult'],
    ['hybrid','Hybrid'],['electric','Electric Bikes'],['fat','Fat Bike'],
    ['geared','Geared Cycles'],['tricycle','Tricycle'],['all','All Cycles']
  ];
  const API = SUPABASE_URL + '/rest/v1/homepage_category_photos';
  const OBJECTS = SUPABASE_URL + '/storage/v1/object';
  const panel = document.getElementById('categoryPhotosManager');
  const list = document.getElementById('categoryPhotoList');
  const status = document.getElementById('categoryPhotoStatus');
  const drafts = new Map(), cards = new Map(), defaults = new Map();
  let rows = [], busy = false, resumeCategoryLogin = false;
  const imageURL = path => OBJECTS + '/public/category-photos/' + encodeURIComponent(path);
  const message = (value,error=false) => { status.textContent=value;status.dataset.error=String(error); };
  function setBusy(value){busy=value;panel.querySelectorAll('button,input').forEach(el=>el.disabled=value || (el.dataset.action==='choose' && rows.length!==CATEGORIES.length));}
  async function request(url,options={}){
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(45000)});
    if(!response.ok){
      if(response.status===401){resumeCategoryLogin=true;window.mmShowroomMedia.showSignIn();throw new Error('Cloud login காலாவதியாகிவிட்டது. மீண்டும் Sign in செய்துவிட்டு Save photo அழுத்துங்கள்.');}
      if(response.status===403)throw new Error('இந்தப் படத்தை மாற்ற showroom owner account மூலம் Sign in செய்யுங்கள்.');
      throw new Error('Category photo சேமிக்க / பெற முடியவில்லை. இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.');
    }
    return response;
  }
  function releaseDraft(key){const draft=drafts.get(key);if(draft)URL.revokeObjectURL(draft.url);drafts.delete(key);}
  function paintCard(key,row){
    const card=cards.get(key);if(!card)return;
    card.querySelector('.category-custom-image')?.remove();
    card.classList.toggle('category-custom',Boolean(row?.image_path));
    if(row?.image_path){
      const img=document.createElement('img');img.className='category-custom-image';img.alt=CATEGORIES.find(item=>item[0]===key)[1];img.loading='lazy';
      img.onerror=()=>{img.remove();card.classList.remove('category-custom');};
      img.src=imageURL(row.image_path);card.prepend(img);
    }
  }
  function render(){
    const ready=rows.length===CATEGORIES.length;
    list.innerHTML=CATEGORIES.map(([key,label])=>{
      const row=rows.find(item=>item.category_key===key),draft=drafts.get(key),fallback=defaults.get(key);
      const src=draft?.url || (row?.image_path?imageURL(row.image_path):fallback?.image);
      return `<article class="category-photo-row" id="category-photo-${key}" data-category-editor="${key}"><div class="category-preview">${src?`<img src="${esc(src)}" alt="${esc(label)} photo preview">`:`<span aria-hidden="true">${esc(fallback?.icon||'🚲')}</span>`}</div><div class="category-photo-info"><h4>${esc(label)}</h4><p>${draft?'New photo selected — press Save photo.':row?.image_path?'Custom photo saved':'Default photo'}</p><input type="file" id="category-file-${key}" accept="image/jpeg,image/png,image/webp" hidden><div class="category-photo-actions"><button type="button" data-action="choose" ${!ready?'disabled':''}>${row?.image_path?'Replace photo':'Upload photo'}</button>${draft?'<button type="button" data-action="save" class="category-save">Save photo</button><button type="button" data-action="cancel">Cancel</button>':''}${row?.image_path?'<button type="button" data-action="restore">Restore default</button>':''}</div></div></article>`;
    }).join('');
    list.querySelectorAll('[data-category-editor]').forEach(editor=>{
      const key=editor.dataset.categoryEditor,input=editor.querySelector('input[type=file]');
      editor.querySelector('[data-action=choose]').onclick=()=>input.click();
      input.onchange=()=>{
        const file=input.files[0];input.value='';if(!file)return;
        if(!['image/jpeg','image/png','image/webp'].includes(file.type)){message('JPG, PNG அல்லது WebP photo தேர்ந்தெடுக்கவும்.',true);return;}
        if(file.size>20*1024*1024){message('20 MB-க்கும் குறைவான photo தேர்ந்தெடுக்கவும்.',true);return;}
        releaseDraft(key);drafts.set(key,{file,url:URL.createObjectURL(file)});render();message('Preview-ஐப் பார்த்து Save photo அழுத்துங்கள்.');
        document.getElementById('category-photo-'+key).scrollIntoView({block:'nearest',behavior:'smooth'});
      };
      const save=editor.querySelector('[data-action=save]');if(save)save.onclick=()=>run(()=>upload(key));
      const cancel=editor.querySelector('[data-action=cancel]');if(cancel)cancel.onclick=()=>{releaseDraft(key);render();message('Selection cancelled.');};
      const restore=editor.querySelector('[data-action=restore]');if(restore)restore.onclick=()=>{if(confirm('இந்த category-க்கு பழைய default photo-வை மீண்டும் வைக்க வேண்டுமா?'))run(()=>restoreDefault(key));};
    });
    if(busy)setBusy(true);
  }
  async function load(){
    const response=await request(API+'?select=category_key,image_path,revision',{headers:{apikey:SUPABASE_KEY},cache:'no-store'});
    const result=await response.json();
    if(!Array.isArray(result)||result.length!==CATEGORIES.length||!CATEGORIES.every(([key])=>result.some(row=>row.category_key===key)))throw new Error('Category photos வரவில்லை. Reload photos அழுத்தி மீண்டும் முயற்சிக்கவும்.');
    rows=result;rows.forEach(row=>paintCard(row.category_key,row));render();
  }
  async function update(row,path,auth){
    const response=await request(`${API}?category_key=eq.${row.category_key}&revision=eq.${row.revision}`,{method:'PATCH',headers:{...auth,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({image_path:path,revision:row.revision+1})});
    const saved=await response.json();if(!saved.length)throw new Error('இந்த photo வேறு device-ல் மாற்றப்பட்டுள்ளது. Reload photos செய்து மீண்டும் Save செய்யுங்கள்.');
    rows=rows.map(item=>item.category_key===row.category_key?saved[0]:item);paintCard(row.category_key,saved[0]);
  }
  async function removeObject(path,auth){if(path)await request(OBJECTS+'/category-photos',{method:'DELETE',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});}
  async function upload(key){
    const draft=drafts.get(key),row=rows.find(item=>item.category_key===key);if(!draft||!row)throw new Error('Photo-வை மீண்டும் தேர்ந்தெடுக்கவும்.');
    resumeCategoryLogin=true;const auth=await window.mmShowroomMedia.authHeaders();resumeCategoryLogin=false;
    const blob=await window.mmShowroomMedia.compressImage(draft.file),path=`category-${key}-${crypto.randomUUID()}.jpg`;
    await request(OBJECTS+'/category-photos/'+path,{method:'POST',headers:{...auth,'Content-Type':'image/jpeg','Cache-Control':'max-age=31536000'},body:blob});
    try{await update(row,path,auth);}catch(error){
      // The update may have committed even if its response was lost.
      try{const check=await request(`${API}?category_key=eq.${key}&select=image_path`,{headers:{apikey:SUPABASE_KEY},cache:'no-store'});const latest=await check.json();if(latest[0]?.image_path!==path)await removeObject(path,auth);}catch{}
      throw error;
    }
    releaseDraft(key);try{await removeObject(row.image_path,auth);}catch{}
  }
  async function restoreDefault(key){const row=rows.find(item=>item.category_key===key);resumeCategoryLogin=true;const auth=await window.mmShowroomMedia.authHeaders();resumeCategoryLogin=false;await update(row,null,auth);releaseDraft(key);try{await removeObject(row.image_path,auth);}catch{}}
  async function run(action){
    if(busy)return;setBusy(true);message('Saving category photo…');
    try{await action();render();message('Saved. Category photo எல்லோருக்கும் புதுப்பிக்கப்பட்டுவிட்டது.');}
    catch(error){message(error.message,true);}
    finally{setBusy(false);}
  }
  document.getElementById('categoryReload').onclick=async()=>{if(busy)return;setBusy(true);try{await load();message('Category photos reloaded.');}catch(error){message(error.message,true);}finally{setBusy(false);}};
  document.getElementById('categorySignIn').onclick=()=>{resumeCategoryLogin=true;window.mmShowroomMedia.showSignIn();};
  document.addEventListener('mm-cloud-signed-in',()=>{if(!resumeCategoryLogin)return;resumeCategoryLogin=false;message('Signed in. உங்கள் தேர்ந்தெடுத்த photo-க்கு Save photo அழுத்துங்கள்.');panel.scrollIntoView({block:'start',behavior:'smooth'});});
  function initialize(){
    const ownerVisible=document.querySelector('.adminFab')?.classList.contains('ownerVisible');
    CATEGORIES.forEach(([key,label])=>{
      const card=document.querySelector(`#shop .cc[data-category="${key}"]`);if(!card)return;
      cards.set(key,card);defaults.set(key,{image:card.querySelector('img')?.src,icon:card.querySelector('.bikeicon')?.textContent});
      const edit=document.createElement('button');edit.type='button';edit.className='category-card-edit';edit.textContent='Change photo';edit.setAttribute('aria-label','Change '+label+' photo');edit.hidden=!ownerVisible;
      edit.onclick=()=>{openAdmin('categoryPhotosManager');if(document.getElementById('adminModal').classList.contains('show'))document.getElementById('category-photo-'+key)?.scrollIntoView({block:'center',behavior:'smooth'});};
      card.appendChild(edit);
    });
    const shortcut=document.getElementById('categoryEditShortcut');shortcut.hidden=!ownerVisible;shortcut.onclick=()=>openAdmin('categoryPhotosManager');
    render();load().then(()=>message('ஒவ்வொரு category-க்கும் photo தேர்ந்தெடுத்து Save photo அழுத்துங்கள்.')).catch(error=>message(error.message,true));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();
