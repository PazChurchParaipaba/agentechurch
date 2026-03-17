const SUPABASE_URL='https://csxitgraaawziaflveol.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzeGl0Z3JhYWF3emlhZmx2ZW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExOTE5NzksImV4cCI6MjA4Njc2Nzk3OX0.sqcgO8gZZ7UPotWOnlQ8FQWhkxKnx_hsh7pRsCi1s2g';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const LEADER_PIN='1234';
const LEADER_WA='5585999999999';
const AGE_LABELS={bebe:'Bebe (0-2)',maternal:'Maternal (3-4)',jardim:'Jardim (5-6)',primario:'Primario (7-9)',junior:'Junior (10-12)'};
let childrenData=[],parentChannel=null,alertSilenced=false,alertBeeping=false,beepInterval=null,pinBuffer='',leaderUnlocked=false;

// ─────────────────────────────────────────────────
// PIN
// ─────────────────────────────────────────────────
function pinPress(val){
  const err=document.getElementById('pin-error');
  err.classList.add('hidden');
  if(val==='back'){pinBuffer=pinBuffer.slice(0,-1);}
  else if(val==='ok'){checkPin();return;}
  else{if(pinBuffer.length>=4)return;pinBuffer+=val;}
  for(let i=0;i<4;i++) document.getElementById('dot'+i).classList.toggle('filled',i<pinBuffer.length);
  if(pinBuffer.length===4) checkPin();
}
function checkPin(){
  if(pinBuffer===LEADER_PIN){
    leaderUnlocked=true;
    document.getElementById('pin-overlay').classList.add('hidden');
    loadChildren();
  } else {
    document.getElementById('pin-error').classList.remove('hidden');
    document.getElementById('pin-overlay').classList.add('shake');
    setTimeout(()=>document.getElementById('pin-overlay').classList.remove('shake'),500);
    pinBuffer='';
    for(let i=0;i<4;i++) document.getElementById('dot'+i).classList.remove('filled');
  }
}
function skipToParent(){document.getElementById('pin-overlay').classList.add('hidden');showSection('parent');}

// ─────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────
function showSection(sec){
  document.getElementById('admin-section').style.display=sec==='admin'?'block':'none';
  document.getElementById('parent-section').style.display=sec==='parent'?'block':'none';
  const ta=document.getElementById('tab-admin'),tp=document.getElementById('tab-parent');
  ta.classList.toggle('tab-active',sec==='admin');
  tp.classList.toggle('tab-active',sec==='parent');
  ta.classList.toggle('border-gray-200',sec!=='admin');ta.classList.toggle('text-gray-500',sec!=='admin');
  tp.classList.toggle('border-gray-200',sec!=='parent');tp.classList.toggle('text-gray-500',sec!=='parent');
  if(sec==='admin'&&leaderUnlocked) loadChildren();
  else if(sec==='parent'){const n=new URLSearchParams(window.location.search).get('number');if(n){document.getElementById('parent-number').value=n;loadParentStatus();}}
}

// ─────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────
async function loadChildren(){
  try{
    const{data,error}=await sb.from('children').select('*').order('number',{ascending:true});
    if(error) throw error;
    childrenData=data||[];
    renderDashboard(childrenData);updateStats(childrenData);handleAlerts(childrenData);
  }catch(err){document.getElementById('dashboard').innerHTML='<div class="p-6 text-center text-red-400">Erro: '+err.message+'</div>';}
}

// ─────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────
function updateStats(d){
  document.getElementById('stat-total').textContent=d.length;
  document.getElementById('stat-ok').textContent=d.filter(c=>c.status==='green').length;
  document.getElementById('stat-alert').textContent=d.filter(c=>c.status==='red').length;
  document.getElementById('stat-babies').textContent=d.filter(c=>c.age_group==='bebe').length;
}

// ─────────────────────────────────────────────────
// ALERTAS
// ─────────────────────────────────────────────────
function handleAlerts(data){
  const alerting=data.filter(c=>c.status==='red');
  const banner=document.getElementById('alert-banner');
  if(alerting.length>0&&!alertSilenced){
    banner.classList.remove('hidden');
    document.getElementById('alert-names').textContent=alerting.map(c=>'#'+c.number+' '+(c.child_name||'')).join(' - ');
    if(!alertBeeping){alertBeeping=true;playBeep();beepInterval=setInterval(playBeep,8000);}
  } else {banner.classList.add('hidden');stopBeep();}
}
function silenceAlert(){alertSilenced=true;stopBeep();document.getElementById('alert-banner').classList.add('hidden');setTimeout(()=>{alertSilenced=false;},2*60*1000);}
function stopBeep(){alertBeeping=false;if(beepInterval){clearInterval(beepInterval);beepInterval=null;}}
function playBeep(){
  try{
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ac.createOscillator(),gain=ac.createGain();
    osc.connect(gain);gain.connect(ac.destination);osc.type='triangle';
    [880,1109,880,1109].forEach((f,i)=>osc.frequency.setValueAtTime(f,ac.currentTime+i*.18));
    gain.gain.setValueAtTime(.4,ac.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.9);
    osc.start(ac.currentTime);osc.stop(ac.currentTime+.9);
  }catch(_){}
}

// ─────────────────────────────────────────────────
// HELPERS API
// ─────────────────────────────────────────────────
function getApiBase(){
  return localStorage.getItem('paz_church_api_url')
    ?localStorage.getItem('paz_church_api_url').replace(/\/$/,'')+'/api'
    :(location.port==='3000'?'http://localhost:3000/api':location.origin+'/api');
}

// ─────────────────────────────────────────────────
// ADD CHILD (CHECK-IN)
// Fluxo: salvar → gerar cartão → enviar cartão c/ QR via WhatsApp pro pai
// ─────────────────────────────────────────────────
async function addChild(){
  const cName=document.getElementById('child-name').value.trim();
  const pName=document.getElementById('parent-name').value.trim();
  const pPhone=document.getElementById('parent-phone').value.trim().replace(/\D/g,'');
  const age=document.getElementById('child-age-group').value;
  if(!cName){document.getElementById('child-name').focus();return;}
  const btn=document.getElementById('addChildBtn');btn.disabled=true;btn.textContent='Salvando...';
  try{
    const{data:mx}=await sb.from('children').select('number').order('number',{ascending:false}).limit(1);
    const next=mx&&mx.length>0?mx[0].number+1:1;
    const{error}=await sb.from('children').insert([{number:next,child_name:cName,parent_name:pName||null,parent_phone:pPhone||null,age_group:age||null,status:'green',checkin_at:new Date().toISOString()}]);
    if(error) throw error;
    ['child-name','parent-name','parent-phone'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('child-age-group').value='';

    // Gera a URL do QR do pai (a mesma que o scanner vai ler)
    const qrUrl=location.origin+'/pazkids?number='+next;
    showQrCode(qrUrl,next,cName);
    loadChildren();
    alertSilenced=false;

    // Se tiver telefone, envia o cartão com QR automaticamente via WhatsApp
    if(pPhone){
      btn.textContent='Enviando cartao...';
      try{
        const child={number:next,child_name:cName,parent_name:pName||null,parent_phone:pPhone,age_group:age||null,checkin_at:new Date().toISOString()};
        await sendCardToParent(child);
      }catch(e){
        console.error('Erro ao enviar cartao automaticamente:', e);
        // Não bloquear: check-in foi feito com sucesso, só o envio falhou
        Swal.fire({toast:true,position:'bottom-end',icon:'warning',title:'Check-in feito! Mas o cartao nao foi enviado via WhatsApp.',showConfirmButton:false,timer:5000});
      }
    }
  }catch(err){Swal.fire('Erro',err.message,'error');}
  finally{btn.disabled=false;btn.textContent='✅ Fazer Check-in';}
}

// ─────────────────────────────────────────────────
// QR CODE PREVIEW (mostra no painel do líder)
// ─────────────────────────────────────────────────
function showQrCode(url,number,name){
  const result=document.getElementById('qr-result'),canvas=document.getElementById('qr-canvas'),label=document.getElementById('qr-label');
  result.classList.remove('hidden');
  label.innerHTML='<strong>#'+number+'</strong> - '+name;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  QRCode.toCanvas(canvas,url,{width:130,margin:2,color:{dark:'#4338ca',light:'#f5f3ff'}},err=>{if(err)console.error(err);});
}

// ─────────────────────────────────────────────────
// GERAR CARTÃO E ENVIAR POR WHATSAPP (para o pai)
// O QR Code do cartão contém a URL do filho → o scanner do líder lê na saída
// ─────────────────────────────────────────────────
async function sendCardToParent(child){
  // Canvas menor (560x336) + JPEG para reduzir payload (~100kb vs ~800kb PNG)
  const canvas=document.createElement('canvas');
  canvas.width=560;canvas.height=336;
  const ctx=canvas.getContext('2d');

  // Fundo branco
  ctx.fillStyle='#ffffff';
  ctx.fillRect(0,0,560,336);

  // Header gradiente
  const grad=ctx.createLinearGradient(0,0,560,0);
  grad.addColorStop(0,'#6366f1');
  grad.addColorStop(1,'#7c3aed');
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,560,80);

  ctx.font='bold 24px Arial';
  ctx.fillStyle='#ffffff';
  ctx.fillText('PAZ KIDS', 24, 38);
  ctx.font='12px Arial';
  ctx.fillStyle='rgba(255,255,255,0.8)';
  ctx.fillText('Paz Church Paraipaba - Cartao de Retirada', 24, 60);

  // Circulo com numero
  ctx.beginPath();
  ctx.arc(88,184,58,0,Math.PI*2);
  const cg=ctx.createRadialGradient(88,184,0,88,184,58);
  cg.addColorStop(0,'#818cf8');cg.addColorStop(1,'#6366f1');
  ctx.fillStyle=cg;ctx.fill();
  ctx.font='bold 42px Arial';
  ctx.fillStyle='#ffffff';ctx.textAlign='center';
  ctx.fillText(child.number,88,198);
  ctx.font='10px Arial';ctx.fillStyle='#94a3b8';
  ctx.fillText('NUMERO',88,252);ctx.textAlign='left';

  // Divisor
  ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(168,90);ctx.lineTo(168,268);ctx.stroke();

  // Info
  ctx.font='bold 18px Arial';ctx.fillStyle='#1e293b';
  ctx.fillText(child.child_name||'Sem nome',184,128);
  ctx.font='13px Arial';ctx.fillStyle='#64748b';
  ctx.fillText('Resp.: '+(child.parent_name||'Nao informado'),184,152);

  if(child.age_group){
    const ageMap={bebe:'Bebe',maternal:'Maternal',jardim:'Jardim',primario:'Primario',junior:'Junior'};
    const lbl=ageMap[child.age_group]||child.age_group;
    const w=ctx.measureText(lbl).width+16;
    ctx.fillStyle='#e0e7ff';
    ctx.roundRect?ctx.roundRect(184,162,w,20,8):ctx.fillRect(184,162,w,20);
    ctx.fill();ctx.fillStyle='#4338ca';ctx.font='bold 11px Arial';
    ctx.fillText(lbl,192,176);
  }

  if(child.checkin_at){
    ctx.font='12px Arial';ctx.fillStyle='#94a3b8';
    ctx.fillText('Check-in: '+new Date(child.checkin_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),184,200);
  }

  ctx.font='bold 11px Arial';ctx.fillStyle='#475569';
  ctx.fillText('Apresente este QR Code na saida!',184,228);
  ctx.font='11px Arial';ctx.fillStyle='#94a3b8';
  ctx.fillText('O lider vai escanear para liberar a crianca.',184,245);

  // QR Code (120x120)
  const qrCanvas=document.createElement('canvas');
  const qrUrl=location.origin+'/pazkids?number='+child.number;
  await new Promise((res,rej)=>{
    QRCode.toCanvas(qrCanvas,qrUrl,{width:120,margin:1,color:{dark:'#6366f1',light:'#ffffff'}},e=>e?rej(e):res());
  });
  ctx.fillStyle='#f5f3ff';
  ctx.fillRect(416,86,128,128);
  ctx.drawImage(qrCanvas,420,90,120,120);
  ctx.font='10px Arial';ctx.fillStyle='#94a3b8';ctx.textAlign='center';
  ctx.fillText('Escaneie na saida',480,225);ctx.textAlign='left';

  // Footer
  ctx.fillStyle='#f8fafc';
  ctx.fillRect(0,276,560,60);
  ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,276);ctx.lineTo(560,276);ctx.stroke();
  ctx.font='11px Arial';ctx.fillStyle='#94a3b8';ctx.textAlign='center';
  ctx.fillText('Deus abencoe sua familia! -- Paz Church Paraipaba',280,298);
  ctx.fillText('Em caso de emergencia procure um lider do Paz Kids',280,316);
  ctx.textAlign='left';

  // Borda
  ctx.strokeStyle='#6366f1';ctx.lineWidth=3;
  ctx.strokeRect(2,2,556,332);

  // JPEG (muito mais leve que PNG)
  const imageBase64=canvas.toDataURL('image/jpeg',0.82);
  const apiBase=getApiBase();

  const resp=await fetch(apiBase+'/pazkids/send-card',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      phone:child.parent_phone,
      imageBase64,
      childName:child.child_name||'Crianca #'+child.number,
      number:child.number,
      parentName:child.parent_name||''
    })
  });

  if(!resp.ok){
    const txt=await resp.text();
    throw new Error('Servidor retornou '+resp.status+': '+(txt.includes('<')?'Erro interno no servidor':txt));
  }
  const result=await resp.json();
  if(!result.success) throw new Error(result.error||'Erro desconhecido no servidor');
  return result;
}

// Botão manual "Cartão" na lista
async function generateAndSendCard(childId, btn){
  const child=childrenData.find(c=>c.id===childId);
  if(!child) return;
  if(!child.parent_phone){
    Swal.fire('Sem telefone','Este responsavel nao tem WhatsApp cadastrado. Edite o cadastro primeiro para adicionar o numero.','info');
    return;
  }
  const originalText=btn.innerHTML;
  btn.disabled=true;btn.textContent='...';
  try{
    await sendCardToParent(child);
    Swal.fire({toast:true,position:'bottom-end',icon:'success',title:'Cartao enviado para '+child.parent_phone+' !',showConfirmButton:false,timer:4000});
  }catch(err){
    console.error('Erro no cartao:', err);
    Swal.fire('Erro ao enviar','Nao foi possivel enviar o cartao: '+err.message,'error');
  }finally{
    btn.disabled=false;
    btn.innerHTML=originalText;
  }
}

// ─────────────────────────────────────────────────
// TOGGLE STATUS (Chamar pai)
// Quando status muda para "red", manda mensagem no WhatsApp do pai individualmente
// ─────────────────────────────────────────────────
async function toggleStatus(id,cur){
  const ns=cur==='green'?'red':'green';
  if(ns==='green') alertSilenced=false;
  const{error}=await sb.from('children').update({status:ns}).eq('id',id);
  if(error) return Swal.fire('Erro',error.message,'error');

  // Se colocou em alerta (vermelho), notifica o pai via WhatsApp individualmente
  if(ns==='red'){
    const child=childrenData.find(c=>c.id===id);
    if(child&&child.parent_phone){
      const apiBase=getApiBase();
      const pName=child.parent_name?(' '+child.parent_name.split(' ')[0]):'';
      const msg='Ola'+pName+'! 👋\n\nEquipe *Paz Kids* - Paz Church Paraipaba.\n\n🔔 Sua crianca *'+child.child_name+'* (cartao #'+child.number+') precisa de voce no salao infantil.\n\nVenha retirar na entrada do Kids. Te esperamos! 🙏';
      fetch(apiBase+'/send-message',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({phone:child.parent_phone,message:msg})
      }).catch(e=>console.log('Notificacao WA falhou:',e));
    }
  }

  loadChildren();
}

// ─────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────
async function editNames(id,cn,pn,pp,ag){
  const{value:f}=await Swal.fire({title:'Editar Dados',html:'<input id="e-child" class="swal2-input" placeholder="Nome da crianca" value="'+(cn||'')+'"><input id="e-parent" class="swal2-input" placeholder="Nome do pai/mae" value="'+(pn||'')+'"><input id="e-phone" class="swal2-input" placeholder="WhatsApp dos pais" value="'+(pp||'')+'">',focusConfirm:false,showCancelButton:true,confirmButtonText:'Salvar',cancelButtonText:'Cancelar',preConfirm:()=>({childName:document.getElementById('e-child').value.trim()||null,parentName:document.getElementById('e-parent').value.trim()||null,parentPhone:document.getElementById('e-phone').value.trim().replace(/\D/g,'')||null})});
  if(!f) return;
  const{error}=await sb.from('children').update({child_name:f.childName,parent_name:f.parentName,parent_phone:f.parentPhone}).eq('id',id);
  if(error) Swal.fire('Erro',error.message,'error');else loadChildren();
}

// ─────────────────────────────────────────────────
// REMOVE (checkout manual)
// ─────────────────────────────────────────────────
async function removeChild(id,name){
  const{isConfirmed}=await Swal.fire({title:'Check-out: '+name+'?',text:'Remove da lista de hoje.',icon:'question',showCancelButton:true,confirmButtonColor:'#ef4444',confirmButtonText:'Fazer Check-out',cancelButtonText:'Cancelar'});
  if(!isConfirmed) return;
  const{error}=await sb.from('children').delete().eq('id',id);
  if(error) Swal.fire('Erro',error.message,'error');else loadChildren();
}

// ─────────────────────────────────────────────────
// QR REPRINT
// ─────────────────────────────────────────────────
async function showParentLink(number,childName){
  const url=location.origin+'/pazkids?number='+number;
  await Swal.fire({title:'QR Code - #'+number+' '+childName,html:'<p class="text-sm text-gray-500 mb-3">Compartilhe o QR com os pais:</p><div id="swal-qr" class="flex justify-center mb-3"></div><input class="swal2-input text-xs" value="'+url+'" readonly onclick="this.select()">',didOpen:()=>{const d=document.getElementById('swal-qr'),c=document.createElement('canvas');d.appendChild(c);QRCode.toCanvas(c,url,{width:180,margin:2,color:{dark:'#4338ca',light:'#f5f3ff'}});},confirmButtonText:'Fechar',showCancelButton:true,cancelButtonText:'Copiar Link',cancelButtonColor:'#6366f1'}).then(r=>{if(r.isDismissed&&r.dismiss===Swal.DismissReason.cancel) navigator.clipboard.writeText(url).then(()=>Swal.fire({toast:true,position:'bottom-end',icon:'success',title:'Link copiado!',showConfirmButton:false,timer:2000}));});
}

// WHATSAPP DIRETO (toque no botão WA)
function callParent(phone,childName){
  if(!phone){Swal.fire('Sem contato','WhatsApp nao cadastrado.','info');return;}
  const msg=encodeURIComponent('Ola! Equipe Paz Kids. Sua crianca '+childName+' precisa de voce no salao infantil. ');
  window.open('https://wa.me/'+phone+'?text='+msg,'_blank');
}

// ─────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────
function formatTimer(iso){
  if(!iso) return '';
  const diff=Math.floor((Date.now()-new Date(iso).getTime())/1000);
  const m=Math.floor(diff/60),h=Math.floor(m/60);
  return h>0?h+'h'+(m%60)+'m':m+'min';
}

// ─────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────
function renderDashboard(data){
  const db=document.getElementById('dashboard'),kc=document.getElementById('kids-count');
  kc.textContent=data.length+' crianca'+(data.length!==1?'s':'')+' presente'+(data.length!==1?'s':'');
  if(data.length===0){db.innerHTML='<div class="p-12 text-center"><div class="text-5xl mb-3">&#128118;</div><p class="text-gray-400 text-sm">Nenhuma crianca no check-in ainda.</p></div>';return;}
  db.innerHTML=data.map(c=>`
  <div class="child-card ${c.status==='red'?'alert':'ok'} flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 hover:bg-gray-50 rounded-xl mx-2 my-1 transition">
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <div class="w-11 h-11 rounded-full ${c.status==='red'?'gradient-red':'gradient-hero'} flex items-center justify-center text-white font-black text-sm shrink-0 shadow-md">${c.number}</div>
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="font-bold text-gray-800 text-sm">${c.child_name||'Sem nome'}</p>
          ${c.age_group?`<span class="age-badge">${AGE_LABELS[c.age_group]||c.age_group}</span>`:''}
          ${c.checkin_at?`<span class="timer-badge">&#9201; ${formatTimer(c.checkin_at)}</span>`:''}
        </div>
        <p class="text-xs text-gray-400 truncate">&#128100; ${c.parent_name||'Responsavel nao informado'} ${c.parent_phone?'- &#128241; '+c.parent_phone:''}</p>
      </div>
    </div>
    <div class="w-4 h-4 rounded-full shrink-0 ${c.status==='green'?'bg-green-400 pulse-green':'bg-red-500 pulse-red'}"></div>
    <div class="flex gap-1.5 flex-wrap shrink-0">
      <button onclick="toggleStatus('${c.id}','${c.status}')" class="${c.status==='green'?'px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-100 transition':'px-3 py-1.5 bg-green-50 text-green-600 border border-green-200 rounded-lg text-xs font-bold hover:bg-green-100 transition'}">${c.status==='green'?'&#128276; Chamar':'&#9989; OK'}</button>
      ${c.parent_phone?`<button onclick="callParent('${c.parent_phone}','${(c.child_name||'').replace(/'/g,"\\'"+"'")}')\" class=\"px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 transition\">&#128242; WA</button><button onclick="generateAndSendCard('${c.id}',this)" class="px-3 py-1.5 bg-violet-500 text-white rounded-lg text-xs font-bold hover:bg-violet-600 transition" title="Gerar e enviar cartao por WhatsApp">&#128196; Cartao</button>`:''}
      <button onclick="showParentLink(${c.number},'${(c.child_name||'').replace(/'/g,"\\'"+"'")}');" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100 transition">QR</button>
      <button onclick="editNames('${c.id}','${(c.child_name||'').replace(/'/g,"\\'"+"'")}','${(c.parent_name||'').replace(/'/g,"\\'"+"'")}','${c.parent_phone||''}','${c.age_group||''}')\" class=\"px-3 py-1.5 bg-gray-50 text-gray-500 border border-gray-200 rounded-lg text-xs font-bold hover:bg-gray-100 transition\">&#9999;</button>
      <button onclick="removeChild('${c.id}','${(c.child_name||'#'+c.number).replace(/'/g,"\\'"+"'")}')\" class=\"px-3 py-1.5 bg-gray-50 text-gray-400 border border-gray-200 rounded-lg text-xs font-bold hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition\">&#128228;</button>
    </div>
  </div>`).join('');
}

// ─────────────────────────────────────────────────
// BUSCA + FILTRO
// ─────────────────────────────────────────────────
function searchChildren(){
  const q=document.getElementById('search-input').value.toLowerCase();
  const st=document.getElementById('filter-status').value;
  const filtered=childrenData.filter(c=>{
    const mt=!q||c.number.toString().includes(q)||(c.child_name&&c.child_name.toLowerCase().includes(q))||(c.parent_name&&c.parent_name.toLowerCase().includes(q));
    const ms=st==='all'||c.status===st;
    return mt&&ms;
  });
  renderDashboard(filtered);updateStats(filtered);
}

// ─────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────
function exportList(){
  const rows=[['No','Nome','Pai/Mae','Faixa','Status','Hora']];
  childrenData.forEach(c=>rows.push([c.number,c.child_name||'',c.parent_name||'',(AGE_LABELS[c.age_group]||c.age_group||''),c.status==='green'?'OK':'ALERTA',c.checkin_at?new Date(c.checkin_at).toLocaleTimeString('pt-BR'):'']));
  const csv=rows.map(r=>r.map(v=>'"'+v+'"').join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download='pazkids_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.csv';
  a.click();
}

function printList(){window.print();}

// ─────────────────────────────────────────────────
// PARENT STATUS VIEW
// ─────────────────────────────────────────────────
async function loadParentStatus(){
  const number=parseInt(document.getElementById('parent-number').value);
  const btn=document.getElementById('checkBtn');
  if(!number||number<1){document.getElementById('parent-number').focus();return;}
  btn.textContent='...';btn.disabled=true;
  try{
    const{data,error}=await sb.from('children').select('*').eq('number',number).single();
    if(error||!data){Swal.fire({icon:'info',title:'Nao encontrado',text:'Nenhuma crianca com esse numero no check-in de hoje.',confirmButtonColor:'#6366f1'});return;}
    updateParentStatus(data);
    history.replaceState(null,'','?number='+number);
    if(parentChannel) sb.removeChannel(parentChannel);
    parentChannel=sb.channel('pais-rt-'+number).on('postgres_changes',{event:'UPDATE',schema:'public',table:'children',filter:'number=eq.'+number},payload=>{
      updateParentStatus(payload.new);
      if(payload.new.status==='red'){playBeep();if(navigator.vibrate) navigator.vibrate([400,200,400]);}
    }).subscribe();
  }catch(err){Swal.fire('Erro',err.message,'error');}
  finally{btn.textContent='Ver →';btn.disabled=false;}
}

function updateParentStatus(child){
  const d=document.getElementById('parent-status-display'),circle=document.getElementById('status-circle'),icon=document.getElementById('status-icon'),msg=document.getElementById('status-message'),info=document.getElementById('child-info'),timeEl=document.getElementById('checkin-time'),actions=document.getElementById('parent-actions'),waLink=document.getElementById('wa-link');
  d.classList.remove('hidden');
  if(child.status==='green'){
    circle.className='w-32 h-32 rounded-full mx-auto flex flex-col items-center justify-center text-white transition-all duration-700 mb-5 shadow-xl gradient-green pulse-green';
    icon.textContent='&#128522;';msg.textContent='Tudo bem! Sua crianca esta otima.';msg.className='text-lg font-bold text-green-600 mb-1';actions.classList.add('hidden');
  } else {
    circle.className='w-32 h-32 rounded-full mx-auto flex flex-col items-center justify-center text-white transition-all duration-700 mb-5 shadow-xl gradient-red pulse-red';
    icon.textContent='&#128276;';msg.textContent='Sua crianca precisa de voce agora!';msg.className='text-lg font-bold text-red-600 mb-1';
    waLink.href='https://wa.me/'+LEADER_WA+'?text='+encodeURIComponent('Ola! Responsavel pela crianca #'+child.number+' ('+(child.child_name||'')+'), estou a caminho.');
    actions.classList.remove('hidden');
  }
  info.textContent=(child.child_name||'Crianca #'+child.number)+' - Responsavel: '+(child.parent_name||'nao informado');
  timeEl.textContent=child.checkin_at?'Check-in as '+new Date(child.checkin_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'Check-in realizado hoje';
}

// ─────────────────────────────────────────────────
// REALTIME ADMIN
// ─────────────────────────────────────────────────
sb.channel('kids-admin-rt').on('postgres_changes',{event:'*',schema:'public',table:'children'},()=>{
  if(document.getElementById('admin-section').style.display!=='none'&&leaderUnlocked) loadChildren();
}).subscribe(status=>{
  const dot=document.getElementById('realtime-dot');
  dot.className=status==='SUBSCRIBED'?'w-2 h-2 rounded-full bg-green-400 pulse-green':'w-2 h-2 rounded-full bg-yellow-400';
});

// ─────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────
const urlParams=new URLSearchParams(window.location.search);
if(urlParams.get('number')){document.getElementById('pin-overlay').classList.add('hidden');showSection('parent');}

// ============================================================
//  SCANNER DE SAIDA (jsQR)
//  O líder abre o scanner e lê o QR Code que está no celular do PAI
//  O QR do pai contém a URL com ?number=X → identifica a criança → checkout
// ============================================================
let scannerStream   = null;
let scannerActive   = false;
let scannerAnimId   = null;
let lastScannedCode = null;
let lastScanTime    = 0;

async function openScanner(){
  if(typeof jsQR === 'undefined'){
    Swal.fire('Erro','Biblioteca de scan nao carregada. Verifique a conexao e recarregue a pagina.','error');
    return;
  }
  document.getElementById('scanner-modal').classList.remove('hidden');
  document.body.style.overflow='hidden';
  lastScannedCode=null;
  lastScanTime=0;
  document.getElementById('scanner-result').classList.add('hidden');

  try{
    scannerStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}
    });
    const video=document.getElementById('scanner-video');
    video.srcObject=scannerStream;
    await video.play();
    scannerActive=true;
    scanFrame();
  }catch(err){
    let msg=err.message;
    if(err.name==='NotAllowedError') msg='Permissao de camera negada. Permita o acesso nas configuracoes do navegador.';
    else if(err.name==='NotFoundError') msg='Nenhuma camera encontrada neste dispositivo.';
    Swal.fire('Camera indisponivel', msg, 'error');
    closeScanner();
  }
}

function closeScanner(){
  scannerActive=false;
  lastScannedCode=null;
  if(scannerAnimId){cancelAnimationFrame(scannerAnimId);scannerAnimId=null;}
  if(scannerStream){scannerStream.getTracks().forEach(t=>t.stop());scannerStream=null;}
  document.getElementById('scanner-modal').classList.add('hidden');
  document.getElementById('scanner-result').classList.add('hidden');
  document.body.style.overflow='';
}

function scanFrame(){
  if(!scannerActive) return;
  const video=document.getElementById('scanner-video');
  const canvas=document.getElementById('scanner-canvas');

  if(video.readyState===video.HAVE_ENOUGH_DATA){
    canvas.width=video.videoWidth;
    canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
    const code=jsQR(imageData.data,imageData.width,imageData.height,{inversionAttempts:'dontInvert'});

    if(code && code.data!==lastScannedCode && Date.now()-lastScanTime>2500){
      lastScannedCode=code.data;
      lastScanTime=Date.now();
      processScannedQr(code.data);
    }
  }
  scannerAnimId=requestAnimationFrame(scanFrame);
}

async function processScannedQr(data){
  try{
    // Aceita URL completa (/pazkids?number=X) ou só o número
    let number=null;
    if(data.includes('/pazkids') || data.includes('?number=')){
      const url=new URL(data);
      number=url.searchParams.get('number');
    } else if(/^\d+$/.test(data.trim())){
      number=data.trim();
    }

    if(!number){
      // Nao e nosso QR code, ignora silenciosamente
      setTimeout(()=>{lastScannedCode=null;},1500);
      return;
    }

    const child=childrenData.find(c=>String(c.number)===String(number));

    if(!child){
      if(navigator.vibrate) navigator.vibrate([100,50,100]);
      Swal.fire({
        toast:true,position:'top',icon:'warning',
        title:'Crianca #'+number+' nao esta no check-in de hoje.',
        showConfirmButton:false,timer:3500
      });
      setTimeout(()=>{lastScannedCode=null;},3500);
      return;
    }

    // Vibra uma vez (feedback haptico)
    if(navigator.vibrate) navigator.vibrate(200);

    // Preenche o card de resultado
    document.getElementById('scan-number').textContent='#'+child.number;
    document.getElementById('scan-child-name').textContent=child.child_name||'Sem nome';
    document.getElementById('scan-parent-name').textContent='Responsavel: '+(child.parent_name||'Nao Informado');
    const ageEl=document.getElementById('scan-age');
    const ageMap={bebe:'Bebe (0-2)',maternal:'Maternal (3-4)',jardim:'Jardim (5-6)',primario:'Primario (7-9)',junior:'Junior (10-12)'};
    ageEl.textContent=child.age_group?(ageMap[child.age_group]||child.age_group):'';
    ageEl.style.display=child.age_group?'inline':'none';

    const confirmBtn=document.getElementById('scan-confirm-btn');
    confirmBtn.textContent='✅ Liberar Saida';
    confirmBtn.disabled=false;
    confirmBtn.onclick=()=>confirmCheckout(child.id, child.child_name||('Crianca #'+child.number), child.parent_phone, child.parent_name);

    document.getElementById('scan-cancel-btn').onclick=()=>{
      document.getElementById('scanner-result').classList.add('hidden');
      lastScannedCode=null;
    };

    document.getElementById('scanner-result').classList.remove('hidden');

  }catch(e){
    // URL invalida ou sem parametros - ignora
    setTimeout(()=>{lastScannedCode=null;},1000);
  }
}

// ─────────────────────────────────────────────────
// CONFIRMAÇÃO DE CHECKOUT
// Apaga criança do banco e notifica pai via WhatsApp
// ─────────────────────────────────────────────────
async function confirmCheckout(childId, childName, parentPhone, parentName){
  const confirmBtn=document.getElementById('scan-confirm-btn');
  confirmBtn.innerHTML='<span class="inline-block animate-spin mr-2">&#9696;</span>Liberando...';
  confirmBtn.disabled=true;

  try{
    const{error}=await sb.from('children').delete().eq('id',childId);
    if(error) throw error;

    closeScanner();
    loadChildren();

    Swal.fire({
      icon:'success',
      title:'Saida Liberada!',
      html:'<strong>'+childName+'</strong> saiu do Paz Kids com sucesso.<br><small class="text-gray-400">Deus abencoe a familia!</small>',
      timer:4000,
      showConfirmButton:false,
      timerProgressBar:true
    });

    // Notificação individual no WhatsApp para os pais
    if(parentPhone){
      const apiBase=getApiBase();
      const greeting=parentName?' '+parentName.split(' ')[0]:'';
      const msg='Ola'+greeting+'! ✅ Confirmamos a saida de *'+childName+'* do Paz Kids. Foi uma alegria ter ele/ela conosco hoje! Que Deus abencoe muito a familia de voces. 🙏 Paz Church Paraipaba';

      fetch(apiBase+'/send-message',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({phone:parentPhone,message:msg})
      }).catch(e=>console.log('Notificacao WA falhou:',e));
    }

  }catch(err){
    Swal.fire('Erro ao liberar',err.message,'error');
    confirmBtn.textContent='✅ Liberar Saida';
    confirmBtn.disabled=false;
  }
}