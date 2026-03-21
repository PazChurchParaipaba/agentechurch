// Paz Church Paraipaba - WiFi Captive Portal Logic (Name-Based)
let confirmedMember = null;
let currentName = "";

// Funcao para formatar telefone no cadastro
document.getElementById('reg-phone-input')?.addEventListener('input', (e) => {
    let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,5})(\d{0,4})/);
    e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? '-' + x[3] : '');
});

async function searchByName() {
    const name = document.getElementById('name-input').value.trim();
    if (name.length < 5) return Swal.fire('Oops!', 'Por favor, digite seu nome completo', 'warning');

    currentName = name;
    const btn = document.getElementById('btn-next');
    btn.disabled = true;
    btn.innerText = "Verificando...";

    try {
        const res = await fetch(`/api/wifi/search-by-name?name=${encodeURIComponent(name)}`);
        const data = await res.json();

        if (data.found) {
            // Membro encontrado (pode ser 1 ou varios com o mesmo nome)
            showVerify(data.members);
        } else {
            // Nao achou? Vai pro cadastro
            showRegister();
        }
    } catch (e) {
        Swal.fire('Erro', 'Nao foi possivel conectar ao servidor', 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = "Verificar Cadastro \u2192";
    }
}

function showVerify(members) {
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('step-verify').classList.remove('hidden');
    // Armazenamos a lista para bater a data de nascimento no proximo passo
    window.matchingMembers = members;
}

function confirmMember() {
    const bday = document.getElementById('verify-birth-input').value;
    if (!bday) return Swal.fire('Oops', 'Por favor, informe sua data de nascimento para confirmar', 'warning');

    // Tenta achar um que bate com a data
    const match = window.matchingMembers.find(m => m.birth_date === bday || m.birthday === bday);

    if (match) {
        showWelcome(match);
    } else {
        Swal.fire({
            title: 'Nao Batia?',
            text: 'Nao encontramos nenhum cadastro com essa data de nascimento para este nome. Quer tentar cadastrar de novo?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sim, cadastrar',
            cancelButtonText: 'Tentar data de novo'
        }).then((result) => {
            if (result.isConfirmed) showRegister();
        });
    }
}

function showWelcome(member) {
    confirmedMember = member;
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('step-verify').classList.add('hidden');
    document.getElementById('step-register').classList.add('hidden');
    document.getElementById('step-welcome').classList.remove('hidden');
    document.getElementById('welcome-name').innerText = member.name;
}

function showRegister() {
    document.getElementById('step-name').classList.add('hidden');
    document.getElementById('step-verify').classList.add('hidden');
    document.getElementById('step-register').classList.remove('hidden');
    
    // Pre-preenche o nome se ja digitou
    const regName = document.getElementById('name-input').value;
    if (regName) {
        // Poderiamos adicionar um campo de nome no cadastro se quisermos mudar, 
        // mas por enquanto usamos o que ele ja digitou no Passo 1.
    }
}

function resetFlow() {
    document.getElementById('step-name').classList.remove('hidden');
    document.getElementById('step-verify').classList.add('hidden');
    document.getElementById('step-register').classList.add('hidden');
    document.getElementById('step-welcome').classList.add('hidden');
}

async function registerAndConnect() {
    const phone = document.getElementById('reg-phone-input').value.replace(/\D/g, '');
    const bday = document.getElementById('reg-birth-input').value;

    if (!phone || !bday) return Swal.fire('Oops', 'Preencha todos os campos', 'warning');

    Swal.fire({ title: 'Salvando...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});

    try {
        const res = await fetch('/api/wifi/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, name: currentName, birth_date: bday })
        });
        const data = await res.json();
        
        if (data.success) {
            Swal.close();
            releaseAccess();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        Swal.fire('Erro', e.message || 'Erro ao cadastrar', 'error');
    }
}

function releaseAccess() {
    Swal.fire({
        title: 'Sucesso!',
        text: 'Acesso liberado pela Graça! 🙏',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
    }).then(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const redirect = urlParams.get('continue') || 'https://www.google.com';
        window.location.href = redirect;
    });
}
