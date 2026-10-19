import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyBD72eK0MSFWhfSjh1rs2TZaDrAApX1Auk",
  authDomain: "hamstore-751c1.firebaseapp.com",
  databaseURL: "https://hamstore-751c1-default-rtdb.firebaseio.com",
  projectId: "hamstore-751c1",
  storageBucket: "hamstore-751c1.firebasestorage.app",
  messagingSenderId: "810213120501",
  appId: "1:810213120501:web:cc5f9b1e1a94f7ff2de8bc",
  measurementId: "G-KM1D8XVZTR"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export { app, analytics, firebaseConfig };