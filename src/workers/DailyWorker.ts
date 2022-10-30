let daySeconds: number = 86400000;

export const Run = async () => {
    let currentTime: number = new Date().getTime();
    let execTime: number = new Date().setHours(6,0,0,0);  // API call time at 06:00
    let timeLeft: number;
    if(currentTime < execTime) {
      timeLeft = execTime - currentTime;
    } else {
      timeLeft = execTime + daySeconds - currentTime
    }
    setTimeout(function() {
      setInterval(function() {
  
        //your code
  
      }, daySeconds);
    }, timeLeft);
}