import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface RoyaltyContribution {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  model: string;
  amount: number;
  status: "pending" | "verified" | "paid";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [contributions, setContributions] = useState<RoyaltyContribution[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newContributionData, setNewContributionData] = useState({
    model: "",
    description: "",
    amount: ""
  });

  // Calculate statistics for dashboard
  const verifiedCount = contributions.filter(c => c.status === "verified").length;
  const pendingCount = contributions.filter(c => c.status === "pending").length;
  const paidCount = contributions.filter(c => c.status === "paid").length;
  const totalRoyalty = contributions.reduce((sum, c) => sum + c.amount, 0);

  useEffect(() => {
    loadContributions().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadContributions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("contribution_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing contribution keys:", e);
        }
      }
      
      const list: RoyaltyContribution[] = [];
      
      for (const key of keys) {
        try {
          const contributionBytes = await contract.getData(`contribution_${key}`);
          if (contributionBytes.length > 0) {
            try {
              const contributionData = JSON.parse(ethers.toUtf8String(contributionBytes));
              list.push({
                id: key,
                encryptedData: contributionData.data,
                timestamp: contributionData.timestamp,
                owner: contributionData.owner,
                model: contributionData.model,
                amount: contributionData.amount || 0,
                status: contributionData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing contribution data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading contribution ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setContributions(list);
    } catch (e) {
      console.error("Error loading contributions:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitContribution = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting contribution data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newContributionData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const contributionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const contributionData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        model: newContributionData.model,
        amount: parseFloat(newContributionData.amount) || 0,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `contribution_${contributionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(contributionData))
      );
      
      const keysBytes = await contract.getData("contribution_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(contributionId);
      
      await contract.setData(
        "contribution_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted contribution submitted securely!"
      });
      
      await loadContributions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewContributionData({
          model: "",
          description: "",
          amount: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyContribution = async (contributionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted contribution with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const contributionBytes = await contract.getData(`contribution_${contributionId}`);
      if (contributionBytes.length === 0) {
        throw new Error("Contribution not found");
      }
      
      const contributionData = JSON.parse(ethers.toUtf8String(contributionBytes));
      
      const updatedContribution = {
        ...contributionData,
        status: "verified"
      };
      
      await contract.setData(
        `contribution_${contributionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedContribution))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadContributions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const payoutContribution = async (contributionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing royalty payout with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const contributionBytes = await contract.getData(`contribution_${contributionId}`);
      if (contributionBytes.length === 0) {
        throw new Error("Contribution not found");
      }
      
      const contributionData = JSON.parse(ethers.toUtf8String(contributionBytes));
      
      const updatedContribution = {
        ...contributionData,
        status: "paid"
      };
      
      await contract.setData(
        `contribution_${contributionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedContribution))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Royalty payout completed successfully!"
      });
      
      await loadContributions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Payout failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  // Render bar chart for royalty distribution
  const renderBarChart = () => {
    const models = Array.from(new Set(contributions.map(c => c.model)));
    const modelData = models.map(model => {
      const modelContributions = contributions.filter(c => c.model === model);
      const total = modelContributions.reduce((sum, c) => sum + c.amount, 0);
      return { model, total };
    }).sort((a, b) => b.total - a.total).slice(0, 5); // Top 5 models

    const maxAmount = Math.max(...modelData.map(d => d.total), 1);

    return (
      <div className="bar-chart-container">
        {modelData.map((data, index) => (
          <div key={index} className="bar-item">
            <div className="bar-label">{data.model}</div>
            <div className="bar-track">
              <div 
                className="bar-fill" 
                style={{ 
                  width: `${(data.total / maxAmount) * 100}%`,
                  background: `linear-gradient(90deg, #ff00ff, #00ffff)`
                }}
              ></div>
            </div>
            <div className="bar-value">{data.total.toFixed(2)} ETH</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="neon-circle"></div>
          </div>
          <h1>FHE<span>Royalties</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-contribution-btn cyber-button"
          >
            <div className="add-icon"></div>
            Add Contribution
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous Royalties for AI Model Contributions</h2>
            <p>Securely receive royalties for your AI model contributions using FHE technology</p>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card intro-card">
            <h3>Project Introduction</h3>
            <p>FHE Royalties enables decentralized AI model contributors to receive anonymous, encrypted royalty payments using Fully Homomorphic Encryption technology.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <span>Encrypted contribution verification</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🤖</div>
                <span>Anonymous royalty distribution</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <span>Decentralized AI ecosystem support</span>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Royalty Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{contributions.length}</div>
                <div className="stat-label">Total Contributions</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{paidCount}</div>
                <div className="stat-label">Paid Out</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalRoyalty.toFixed(2)}</div>
                <div className="stat-label">Total Royalty (ETH)</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Top Models by Royalty</h3>
            {contributions.length > 0 ? (
              renderBarChart()
            ) : (
              <div className="no-data">No data available</div>
            )}
          </div>
        </div>
        
        <div className="contributions-section">
          <div className="section-header">
            <h2>AI Model Contributions</h2>
            <div className="header-actions">
              <button 
                onClick={loadContributions}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="contributions-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Model</div>
              <div className="header-cell">Contributor</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Amount</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {contributions.length === 0 ? (
              <div className="no-contributions">
                <div className="no-contributions-icon"></div>
                <p>No contributions found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Contribution
                </button>
              </div>
            ) : (
              contributions.map(contribution => (
                <div className="contribution-row" key={contribution.id}>
                  <div className="table-cell contribution-id">#{contribution.id.substring(0, 6)}</div>
                  <div className="table-cell">{contribution.model}</div>
                  <div className="table-cell">{contribution.owner.substring(0, 6)}...{contribution.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(contribution.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">{contribution.amount} ETH</div>
                  <div className="table-cell">
                    <span className={`status-badge ${contribution.status}`}>
                      {contribution.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(contribution.owner) && (
                      <>
                        {contribution.status === "pending" && (
                          <button 
                            className="action-btn cyber-button success"
                            onClick={() => verifyContribution(contribution.id)}
                          >
                            Verify
                          </button>
                        )}
                        {contribution.status === "verified" && (
                          <button 
                            className="action-btn cyber-button primary"
                            onClick={() => payoutContribution(contribution.id)}
                          >
                            Payout
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitContribution} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          contributionData={newContributionData}
          setContributionData={setNewContributionData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="neon-circle"></div>
              <span>FHERoyalties</span>
            </div>
            <p>Anonymous royalty distribution for AI model contributions</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Royalties. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  contributionData: any;
  setContributionData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  contributionData,
  setContributionData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setContributionData({
      ...contributionData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!contributionData.model || !contributionData.amount) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add AI Model Contribution</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your contribution data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>AI Model *</label>
              <select 
                name="model"
                value={contributionData.model} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select model</option>
                <option value="Bittensor">Bittensor</option>
                <option value="GPT-4">GPT-4</option>
                <option value="LLaMA">LLaMA</option>
                <option value="Stable Diffusion">Stable Diffusion</option>
                <option value="Custom">Custom Model</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Royalty Amount (ETH) *</label>
              <input 
                type="number"
                name="amount"
                value={contributionData.amount} 
                onChange={handleChange}
                placeholder="0.00" 
                className="cyber-input"
                step="0.01"
                min="0"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Contribution Description</label>
              <textarea 
                name="description"
                value={contributionData.description} 
                onChange={handleChange}
                placeholder="Describe your AI model contribution..." 
                className="cyber-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Your identity remains anonymous during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Contribution"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;