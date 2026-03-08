import { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Send, Calendar } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

interface Member {
  id: string;
  name: string;
  phone: string;
  birth_date: string;
}

interface Life {
  id: string;
  name: string;
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [members, setMembers] = useState<Member[]>([]);
  const [lives, setLives] = useState<Life[]>([]);
  const [loading, setLoading] = useState(false);

  // Form states
  const [broadcastMsg, setBroadcastMsg] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const membersRes = await axios.get(`${API_URL}/members`);
      setMembers(membersRes.data || []);

      const livesRes = await axios.get(`${API_URL}/lives`);
      setLives(livesRes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const sendBroadcast = async () => {
    if (!broadcastMsg) return;
    try {
      await axios.post(`${API_URL}/broadcast`, {
        message: broadcastMsg,
        group_id: 'church_group' // Placeholder
      });
      alert('Mensagem enviada/agendada!');
      setBroadcastMsg('');
    } catch (e) {
      alert('Erro ao enviar.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-dark text-white p-6 sticky top-0 h-screen">
        <h1 className="text-2xl font-bold mb-8 flex items-center gap-2">
          ⛪ Agente Igreja
        </h1>

        <nav className="space-y-4">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition ${activeTab === 'dashboard' ? 'bg-primary' : 'hover:bg-white/10'}`}
          >
            <Calendar size={20} /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition ${activeTab === 'members' ? 'bg-primary' : 'hover:bg-white/10'}`}
          >
            <Users size={20} /> Membros
          </button>
          <button
            onClick={() => setActiveTab('broadcast')}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition ${activeTab === 'broadcast' ? 'bg-primary' : 'hover:bg-white/10'}`}
          >
            <Send size={20} /> Disparos
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        {loading && (
          <div className="fixed inset-0 bg-white/50 flex items-center justify-center z-50">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div>
            <h2 className="text-3xl font-bold text-gray-800 mb-6">Bom dia! 🙏</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Total de Membros</h3>
                <p className="text-4xl font-bold text-dark mt-2">{members.length}</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Lives Cadastradas</h3>
                <p className="text-4xl font-bold text-secondary mt-2">{lives.length}</p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Aniversariantes Hoje</h3>
                <p className="text-4xl font-bold text-green-600 mt-2">0</p>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Atividade Recente</h3>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center text-gray-500">
                Nenhuma atividade recente registrada.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'members' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Membros</h2>
              <button className="bg-primary hover:bg-indigo-600 text-white px-4 py-2 rounded-lg transition">
                + Novo Membro
              </button>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-sm">
                  <tr>
                    <th className="p-4">Nome</th>
                    <th className="p-4">Telefone</th>
                    <th className="p-4">Aniversário</th>
                    <th className="p-4">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="p-4 font-medium text-gray-900">{m.name}</td>
                      <td className="p-4 text-gray-600">{m.phone}</td>
                      <td className="p-4 text-gray-600">{m.birth_date}</td>
                      <td className="p-4">
                        <button className="text-primary hover:text-indigo-700">Editar</button>
                      </td>
                    </tr>
                  ))}
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-gray-400">Nenhum membro encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'broadcast' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Disparos</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-lg mb-4">Nova Mensagem</h3>
                <textarea
                  className="w-full border border-gray-300 rounded-lg p-3 h-40 focus:ring-2 focus:ring-primary focus:outline-none resize-none"
                  placeholder="Digite sua mensagem aqui..."
                  value={broadcastMsg}
                  onChange={(e) => setBroadcastMsg(e.target.value)}
                ></textarea>
                <div className="flex justify-between items-center mt-4">
                  <span className="text-sm text-gray-500">Isso será enviado para todos os líderes.</span>
                  <button
                    onClick={sendBroadcast}
                    className="bg-primary hover:bg-indigo-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 transition"
                  >
                    <Send size={18} /> Enviar Agora
                  </button>
                </div>
              </div>

              <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100">
                <h3 className="font-bold text-indigo-900 mb-2">Dica Anti-Spam</h3>
                <p className="text-indigo-700 text-sm">
                  O sistema envia mensagens com atraso aleatório de 30 a 120 segundos para evitar bloqueio do WhatsApp.
                  Não tente enviar muitas mensagens de uma vez só manualmente.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
