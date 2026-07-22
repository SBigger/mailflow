import React, {useEffect, useState} from 'react';
import {supabase} from "@/api/supabaseClient.js";
import {useNavigate} from "react-router-dom";

const BucketSizeDisplay = ({bucketName, maxSizeGB, usedSizeGB, percentage, onClose}) => {
    const navigate = useNavigate();
    const [progressColor, setProgressColor] = useState('#3b82f6');
    const [upgrade, setUpgrade] = useState(false);

    useEffect(() => {
        if (percentage > 85) setProgressColor('#ef4444'), setUpgrade(true);
        else if (percentage > 65) setProgressColor('#f59e0b');
    }, [usedSizeGB]);

    return (
        <div style={styles.floatingCard}>
            {/* Schließen-Button */}
            {onClose && (
                <button
                    onClick={onClose}
                    style={styles.closeButton}
                    title="Schließen"
                    aria-label="Schließen"
                >
                    &times;
                </button>
            )}

            <div style={styles.header}>
                <span style={styles.bucketName}>{bucketName}</span>
                <span style={styles.percentageText}>{percentage}% voll</span>
            </div>

            <div style={styles.progressTrack}>
                <div
                    style={{
                        ...styles.progressBar,
                        width: `${percentage}%`,
                        backgroundColor: progressColor
                    }}
                />
            </div>

            <div className="flex flex-col gap-3 text-xs mt-2" style={{ color: '#6b826b' }}>
                {/* Obere Zeile: Status-Texte nebeneinander */}
                <div className="flex justify-between w-full">
                    <span>{usedSizeGB} GB von {maxSizeGB} GB genutzt</span>
                    <span>{parseFloat(maxSizeGB - usedSizeGB).toFixed(1)} GB frei</span>
                </div>

                {/* Untere Zeile: Upgrade Button über die volle Breite */}
                {upgrade ? (
                    <button
                        onClick={() => navigate('/settings#upgrade')}
                        className="w-full py-2 text-xs font-semibold rounded-lg border transition-all duration-200 hover:brightness-95 active:scale-95"
                        style={{
                            color: '#2d3a2d',
                            backgroundColor: '#f2f5f2',
                            borderColor: '#bfcfbf'
                        }}
                    >
                        Upgrade
                    </button>
                ) : <></>}
            </div>
        </div>
    );
};

const styles = {
    floatingCard: {
        // Macht die Karte zu einem schwebenden Fenster
        position: 'fixed',
        bottom: '24px', // Abstand zum unteren Rand
        right: '24px',  // Abstand zum rechten Rand
        zIndex: 9999,   // Liegt immer über allen anderen Elementen

        backgroundColor: '#ffffff',
        borderRadius: '16px',
        padding: '24px 20px 20px 20px',
        // Tieferer Schatten für den "Floating"-Effekt:
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '360px',
        width: 'calc(100% - 48px)', // Responsiv auf Smartphones
        boxSizing: 'border-box',
        border: '1px solid #f3f4f6',

        // Sanfte Animation beim Erscheinen
        animation: 'slideIn 0.3s ease-out-out',
    },
    closeButton: {
        position: 'absolute',
        top: '0px',
        right: '14px',
        background: 'none',
        border: 'none',
        fontSize: '22px',
        fontWeight: 'bold',
        color: '#9ca3af',
        cursor: 'pointer',
        lineHeight: '1',
        padding: '4px 8px',
        borderRadius: '50%',
        transition: 'color 0.2s, background-color 0.2s',
        outline: 'none',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
        paddingRight: '15px'
    },
    bucketName: {
        fontWeight: '600',
        color: '#1f2937',
        fontSize: '15px'
    },
    percentageText: {
        fontSize: '13px',
        fontWeight: '700',
        color: '#4b5563'
    },
    progressTrack: {
        backgroundColor: '#e5e7eb',
        borderRadius: '9999px',
        height: '10px',
        width: '100%',
        overflow: 'hidden',
        marginBottom: '10px'
    },
    progressBar: {
        height: '100%',
        borderRadius: '9999px',
        transition: 'width 0.5s ease-in-out, background-color 0.3s ease'
    }
};

export default BucketSizeDisplay;